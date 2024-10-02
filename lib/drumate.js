const {
  Attr, uniqueId, toArray, sysEnv, Cache
} = require("@drumee/server-essentials");
const { rmSync, mkdirSync } = require("fs");
const { normalize } = require('path');
const { mfs_dir } = sysEnv();

const Common = require(".");

class Drumate extends Common {

  /**
   * 
   * @param {*} opt 
   * @returns 
   */
  async removeHubs(opt) {
    let { db_name, id, filename } = opt;
    console.log("removeHubs", db_name, id, filename);
    if (!db_name) {
      console.log(`${filename} doesn't have any hub`);
      return;
    }
    let hubs = await this.yp.await_proc(`${db_name}.show_hubs`);
    hubs = toArray(hubs) || [];
    let re = new RegExp(`^${mfs_dir}`);
    for (let hub of hubs) {
      if (hub.owner_id == id) {
        console.log(`DELETING CONTENT ${hub.name}...`);
        await this.yp.await_proc(`${hub.db_name}.remove_all_members`, 0);
        if (hub.home_dir && re.test(hub.home_dir)) {
          rmSync(hub.home_dir, { recursive: true, force: true });
        }
        await this.yp.await_proc(`drumate_vanish`, hub.id);
      } else {
        await this.yp.await_proc(`${db_name}.leave_hub`, hub.id);
      }
    }
  }

  /**
  * 
  * @param {*} opt 
  */
  async remove(opt = {}) {
    let { email, id } = opt;
    email = email || id;
    let drumate = await this.yp.await_proc('get_user', email) || {};
    await this.removeHubs(drumate);
    if (drumate.id) {
      this.debug("Removing drumate", { email });
      await this.yp.await_proc("entity_delete", drumate.id);
      let re = new RegExp(`^${mfs_dir}`);
    }
  }

  /**
   *
   */
  async userExists(email) {
    let sql = `SELECT * FROM drumate where email=?`
    let user = await this.yp.await_query(sql, email);
    if (!user || !user.id || !user.email) return false;
    user = await this.yp.await_proc("get_user", email);
    return { ...user, email };
  }

  /**
  * 
  */
  async initFolders(user = {}, folders) {
    let { db_name } = user;
    if (!db_name) {
      db_name = this.get(Attr.db_name);
    }
    if (!db_name) {
      console.error("Require db_name");
      return;
    }
    if (!folders) {
      folders = [];
      for (let dir of ["_photos", "_documents", "_videos", "_musics"]) {
        folders.push({ path: Cache.message(dir) });
      }
    }
    await this.yp.await_proc(`${db_name}.mfs_init_folders`, folders, 1);

  }

  /**
   * 
   * @param {*} oldId 
   * @param {*} newId 
   * @param {*} home_dir hub_id
   */
  async updateEntries(opt) {
    let {
      db_name,
      newId,
      oldId,
      home_dir,
      type,
      vhost,
      status
    } = opt;
    status = status || 'active';
    home_dir = home_dir.replace(/(\/__storage__.*)$/g, '');

    let sql = [
      `UPDATE vhost SET id=? WHERE id=?`,
      `UPDATE entity SET id=? WHERE id=?`,
      `UPDATE privilege SET uid=? WHERE uid=?`,
      `UPDATE disk_usage SET hub_id=? WHERE hub_id=?`,
      `UPDATE ${db_name}.permission SET entity_id=? WHERE entity_id=?`
    ];

    if (type == 'drumate') {
      sql.push(`UPDATE drumate SET id=? WHERE id=?`)
      sql.push(`UPDATE hub set owner_id=? WHERE owner_id=? AND serial=0`);
    } else {
      sql.push(`UPDATE hub SET id=? WHERE id=?`)
    }

    for (let s of sql) {
      await this.yp.await_query(s, newId, oldId);
    }

    let s = `UPDATE entity SET home_dir=? WHERE id=?`;
    await this.yp.await_query(s, home_dir, newId);
    console.log(`Creating new entity home_dir`, home_dir);

    if (vhost) {
      sql = `UPDATE vhost set fqdn=?, id=? WHERE id=?`;
      await this.yp.await_query(sql, vhost, newId, oldId);
    }
    sql = `UPDATE entity set status=? WHERE id=?`;
    await this.yp.await_query(sql, status, oldId);

    let res;
    if (type == 'drumate') {
      res = await this.yp.await_proc('get_user', newId);
    } else {
      res = await this.yp.await_proc("get_hub", newId);
    }
    mkdirSync(home_dir, { recursive: true });
    return res;
  }

  /***
  * 
  */
  async create(opt) {
    let {
      username,
      firstname,
      email,
      lastname,
      domain,
      privilege,
      lang,
      category,
      uid,
      status
    } = opt;
    this.debug(`Creating user, email=${email}, privilege=${privilege}`)
    let drumate = await this.userExists(email);
    if (drumate) {

      this.debug(`User already exists with email=${email}`, { drumate });
      this.set({ ...drumate, email });
      return drumate;
    }
    if (!lang) lang = "en";
    username = username || firstname;
    if (lastname) {
      username = username + "." + lastname
    }
    username = username.replace(/[ \']+/g, "");
    username = username.replace(/[é]/g, "e");
    const profile = {
      email,
      firstname,
      lastname,
      lang,
      privilege,
      domain,
      username,
      sharebox: uniqueId(),
      otp: 0,
      category,
    };
    let password = uniqueId();
    this.set({ email });
    let rows = await this.yp.await_proc("drumate_create", password, profile);
    let failed = 0;
    for (let r of rows) {
      if (r && r.failed) {
        failed = 1;
      }
      if (r.drumate) {
        drumate = r.drumate;
      }
    }

    if (failed) {
      console.log(rows);
      console.error("Failed to create user", username);
      await this.remove({ email });
      return;
    }
    drumate.firstname = firstname;
    drumate.lastname = lastname;
    this.set({ ...drumate, email });
    await this.initFolders(drumate);
    if (!drumate || !drumate.id) {
      console.error("Got invalid drumate")
      return
    }
    const { id, home_dir, db_name } = drumate;
    drumate = await this.updateEntries({
      newId: uid,
      oldId: id,
      home_dir,
      type: 'drumate',
      status,
      db_name
    });
    return drumate;
  }

  /**
   * 
   */
  async setWallpaper() {
    let wallpapers = this.get('wallpapers');
    if (!wallpapers) {
      this.warn("No wallpapers available");
      return;
    }
    let index = Math.floor(Math.random() * wallpapers.length);
    let uid = this.get(Attr.uid);
    let i = 0
    let wallpaper = wallpapers[index];
    while (!wallpaper && i < 30) {
      i++;
      index = Math.floor(Math.random() * wallpapers.length);
      wallpaper = wallpapers[index];
    }
    let { vhost, nid, hub_id } = wallpaper;
    let { settings } = await this.yp.await_proc("entity_touch", uid) || {};
    settings = JSON.parse(settings);
    settings.wallpaper = {
      vhost, nid, hub_id
    }
    await this.yp.call_proc("drumate_update_settings", uid, settings);
  }


  /**
   * 
   * @param {*} opt 
   * @returns 
   */
  async createHub(opt) {
    let {
      domain,
      area,
      filename,
      hubname,
      owner_id,
      vhost,
      status
    } = opt;
    vhost = vhost || `${hubname}.${domain}`;
    if (!area) area = Attr.public;
    this.debug(`Creating hub, vhost=${vhost}, area=${area}`);

    let sql = "SELECT * FROM vhost WHERE fqdn=?"
    let { id } = await this.yp.await_query(sql, vhost);
    if (id) {
      this.debug(`Vhost ${vhost} already exists. Skipped.`);
      let hub = await this.yp.await_proc('get_hub', id);
      return hub;
    }

    if (!owner_id) {
      this.debug("owner_id must be defined", opt);
      console.trace()
      return null;
    }

    let db_name = this.get(Attr.db_name);
    if (!db_name) {
      this.debug("No db name found");
      return null;
    }
    const args = { domain, hubname, area, owner_id, filename };
    const options = {};
    const rows = await this.yp.await_proc(
      `${db_name}.desk_create_hub`, args, options
    );
    let hub_id, home_dir, home_id;
    let hub;
    for (let r of rows) {
      if (r && r.failed) {
        console.log({ db_name, hubname, area, owner_id }, rows);
        console.log("FACTORY_ERROR")
        return null;
      }
      if (r.vhost && r.actual_home_id) {
        home_dir = normalize(r.home_dir);
        home_id = r.actual_home_id;
        hub_id = r.hub_id;
        db_name = r.db_name
        hub = { ...r }
        break;
      }
    }
    if (!home_dir || !hub_id) {
      console.log("Failed to create hub", rows)
      return;
    }
    await this.yp.await_func("uniqueId");
    hub = await this.updateEntries({
      newId: hub_id,
      oldId: hub_id,
      home_dir,
      type: 'hub',
      vhost,
      status,
      db_name
    });
    this.debug(`${vhost}has been created succesfully`);
    return hub;
  }

}
module.exports = Drumate;
