const { Mariadb, Logger, uniqueId,
  Network, sysEnv, Attr } = require("@drumee/server-essentials");
const { existsSync, mkdirSync, cpSync, statSync, rmSync } = require("fs");
const { tmp_dir } = sysEnv();
const { join, extname, basename } = require("path");
const { createHash } = require("crypto");
const { getConfigs } = require('./utils');

const { media_vhost } = getConfigs();

// ******
let TMPDIR = `/${tmp_dir}/${uniqueId()}`;


mkdirSync(TMPDIR, { recursive: true });

class Mfs extends Logger {
  /**
    * 
    * @param {*} opt 
    */
  initialize(opt = {}) {
    this.yp = opt.yp || new Mariadb({ name: "yp" });
    const { db_name } = opt;
    if (!db_name) {
      console.log(opt);
      console.trace();
      throw (`Destination db was not found!`);
    }
    this.db = new Mariadb({ name: db_name });
  }


  /**
   * 
   */
  async end() {
    if (!this.db) return;
    await this.db.stop();
  }

  /**
 * 
 */
  async initFolders(user = {}, folders) {
    const { db_name } = user;

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
    //this.debug("INIT FOLDERS ", folders);
    await this.db.await_proc(`mfs_init_folders`, folders, 1);
    const { home_dir } = this.db.await_proc(`mfs_home`);
    mkdirSync(home_dir, { recursive: true });
  }

  /**
   * 
   */
  cleanup() {
    console.log(`Cleaning up tmp dir ${TMPDIR}`)
    rmSync(TMPDIR, { recursive: true, force: true });
  }

  /**
  *
  * @param {*} dir
  * @param {*} filter
  */
  async importTutorial() {
    const { home_id, vhost } = this.toJSON();
    if (!vhost) vhost = media_vhost;
    let re = new RegExp("^http.*\/\/");
    const dest = await this.db.await_proc(`mfs_make_dir`, home_id, ['Tutorials'], 1);
    let tutorials = await Network.request('https://drumee.com/-/svc/yp.tutorials');
    for (let t of tutorials) {
      let node = await this.importFile(t.src, dest);
      if (!node) {
        console.log(`Skip failed`, t)
        continue;
      }
      let target = `https://${vhost}${node.ownpath}`;
      let sql = `REPLACE INTO tutorial SELECT ?, ?`;
      await this.yp.await_query(sql, t.name, target);
    }
  }

  /**
    *
    * @param {*} dir
    * @param {*} filter
    */
  async importFile(url, dest, attr = {}) {
    let { home_dir, owner_id, nid } = dest;
    let { pathname, host } = new URL(url);
    pathname = decodeURI(pathname);
    let hash = createHash("md5");
    hash.update(`${host}-${pathname}`);
    let key = hash.digest("hex");

    let ext = extname(pathname);
    if (ext) {
      key = `${key}${ext}`;
      ext = ext.replace(/^\.+/, '');
    }

    let re = new RegExp(`\.(${ext})$`, 'i');
    let filename = basename(pathname);
    pathname = join(dest.file_path, filename);
    filename = filename.replace(re, '');
    let id = await this.db.await_func(`node_id_from_path`, pathname);
    this.debug(`Importing from ${url} -> ${pathname}`, home_dir);
    if (!home_dir) {
      console.log("NO HOME_DIR", dest);
    }
    if (id != null) {
      let orig = join(home_dir, '__storage__', id, `orig.${ext}`);
      if (existsSync(orig)) {
        console.log(`Filepath (${orig}) ${pathname} already exists. Skipped.`);
        let node = await this.db.await_proc(`mfs_node_attr`, id);
        return { ...node, ownpath: node.file_path };
      }
      let sql = `DELETE FROM media WHERE id=?`;
      await this.db.await_query(sql, id);
    }

    const source = join(TMPDIR, key);

    if (!source || !existsSync(source)) {
      let opt = {
        method: 'GET',
        outfile: source,
        url,
      };
      await Network.request(opt);
    }

    let stat = statSync(source);
    if (stat.isDirectory()) {
      console.log(`Source ${source} is a directory!`);
      return;
    }

    let { filetype, mimetype } = attr;
    if (!filetype || !mimetype) {
      let r = await this.yp.await_query(
        `select category filetype, mimetype, from filecap where extension='${ext}'`
      );
      ({ filetype, mimetype } = r)
    }

    if (!mimetype) mimetype = `application/${ext}`;
    if (!filetype) filetype = `other`;
    home_dir = home_dir.replace(/(\/__storage__.*)$/, '');
    let args = {
      owner_id,
      filename,
      pid: nid,
      category: filetype,
      ext,
      mimetype,
      filesize: stat.size,
      showResults: 1
    };
    let results = { isOutput: 1 };
    let item = await this.db.await_proc("mfs_create_node", args, {}, results);
    if (!item || !item.id) {
      console.log("Failed to create node with", item, args)
      return;
    }
    let base = join(home_dir, '__storage__', item.id);
    let orig = join(base, `orig.${ext}`);
    mkdirSync(base, { recursive: true });
    console.log(`Importing ${url}`);
    console.log(`Copying ${source}-> ${orig}`);
    cpSync(`${source}`, orig, { force: true });
    return item;
  }



  /**
 * 
 * @param {*} opt 
 * @returns 
 */
  async manifest(url) {
    if (!/^http/.test(url)) {
      url = `https://${url}`;
    }
    const { origin, hostname, pathname } = new URL(url);
    let source = `${origin}/-/svc/media.manifest?nid=${pathname}`;
    const data = await Network.request(source);
    return { origin, pathname, hostname, nodes: data[0] };
  }


  /**
   * 
   * @param {*} hub 
   * @param {*} folder 
   * @returns 
   */
  async importContent(vhost) {
    const { origin, nodes } = await this.manifest(vhost);
    const { home_id } = await this.db.await_proc('mfs_home');
    this.debug("Importing from", { home_id, origin });
    //let re = new RegExp("^" + pathname);
    for (let node of nodes) {
      if (!/^(hub|folder)$/i.test(node.filetype)) {
        /** The actual new root is below pathname */
        let pathname = node.ownpath.split(/\/+/);
        pathname.pop(); // Remove filename
        pathname = pathname.filter(function (f) { return f });

        let dir = '/' + pathname.join('/');
        let dest;
        let id = await this.db.await_func(`node_id_from_path`, dir);
        if (id) {
          dest = await this.db.await_proc('mfs_node_attr', id);
        } else {
          if (!pathname.length) {
            dest = await this.db.await_proc('mfs_node_attr', home_id);
          } else {
            dest = await this.db.await_proc(`mfs_make_dir`, home_id, pathname, 1);
          }
        }

        node.origin = origin;
        let url = `${origin}${node.ownpath}`
        await this.importFile(url, dest, node);
      }
    }
  }
}
module.exports = Mfs;