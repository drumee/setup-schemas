const { Attr, Constants } = require("@drumee/server-essentials");
const { isEmpty } = require("lodash");
const { existsSync, mkdirSync, rmSync, statSync } = require("fs");
const { exec } = require("shelljs");
const { ID_NOBODY } = Constants;
const { check_safety } = require("@drumee/server-core").MfsTools;
const { resolve } = require("path");
const { Mariadb, Logger, sysEnv } = require("@drumee/server-essentials");


class __schema extends Logger {
  constructor(...args) {
    super(...args);
    this.initialize = this.initialize.bind(this);
    this.create_media_root = this.create_media_root.bind(this);
    this.create_vfs_root = this.create_vfs_root.bind(this);
    this.create_entity = this.create_entity.bind(this);
    this.delete_entity = this.delete_entity.bind(this);
    this.load_sql = this.load_sql.bind(this);
  }

  /**
   * 
   * @param {*} opt 
   */
  async initialize(opt) {
    this.yp = this.get("yp") || new Mariadb();
    this.schemas_dir = this.get("schemas");
    if (isEmpty(this.get(Attr.type))) {
      throw "attribute type must bet set";
    }
  }


  /**
   * 
   * @returns 
   */
  async create_media_root() {
    let args = {
      owner_id: ID_NOBODY,
      filename: "",
      pid: "0",
      category: "root",
      ext: "root",
      mimetype: "special",
      filesize: 0,
      showResults: 1
    };
    let results = { isOutput: 1 };
    let root = await this.db.await_proc("mfs_create_node", args, {}, results);
    let sql = `UPDATE entity SET home_id='${root.id}' WHERE db_name='${this.entity.db_name}'`;
    await this.yp.await_query(sql);
    return root;
  }

  /**
   * 
   * @returns 
   */
  async create_vfs_root() {
    const { system_user, system_group } = sysEnv();
    const { home_dir, db_name } = this.entity;
    console.log(
      `----- CREATING ROOT for ${system_user}:${system_group} at ${home_dir}-------------\n`
    );
    this.db = new Mariadb({ name: db_name, user: process.env.USER });

    try {
      let dir = resolve(home_dir, "__storage__");
      mkdirSync(dir, { recursive: true });

      // Only root can chown to another user.
      //
      // Natively bin/install runs as root and this is what puts the MFS roots under
      // www-data, which is who the server runs as. In a container the process IS the
      // runtime user (uid 8000) and already owns everything it just created, so the chown
      // is both impossible and unnecessary — every call failed with
      // "chown: changing ownership of '...': Operation not permitted", create_vfs_root
      // returned false before creating the media root, and the pool filled with entities
      // marked pool_state=clean whose storage was never finished.
      //
      // Distinguish the two cases rather than ignoring the error: already owning the tree
      // is fine, NOT owning it and being unable to fix that is a real failure.
      const uid = typeof process.getuid == "function" ? process.getuid() : 0;
      if (uid !== 0) {
        const owner = statSync(home_dir).uid;
        if (owner !== uid) {
          console.log(
            `Cannot set ownership of ${home_dir}: running as uid ${uid}, ` +
            `the tree is owned by uid ${owner}, and only root may change that.`
          );
          return false;
        }
        console.log(
          `Running as uid ${uid}, which already owns ${home_dir} — ` +
          `skipping chown to ${system_user}:${system_group}`
        );
      } else {
        let cmd = `chown -R ${system_user}:${system_group} ${home_dir}`;
        let res = exec(cmd, { silent: true });
        if (res == null || res.code !== 0) {
          console.log(`FAILED TO RUN **${cmd}**`, res.stderr);
          return false;
        }
      }
    } catch (e) {
      console.error(`Failed to create mfs storage ${home_dir}`);
      return false;
    }
    let r = await this.create_media_root();
    if (isEmpty(r) || !existsSync(r.home_dir)) {
      return false;
    }
    return true;
  }

  /**
   * 
   * @returns 
   */
  async create_entity() {
    const type = this.get(Attr.type);
    if (!["hub", "drumate"].includes(type)) {
      console.error(`${type} IS NOT UNSUPPORTED. Please, use [drumate|hub]`);
      return;
    }
    this.entity = await this.yp.await_proc("entity_create", type);
    let res = false;
    if (isEmpty(this.entity)) {
      await this.delete_entity("FAILED CREATE ENTITY");
    } else {
      res = await this.load_sql();
      if (!res) return;
      res = await this.create_vfs_root();
    }
    const { id, db_name, home_id } = this.entity;
    let sql = `UPDATE entity SET settings=JSON_SET(settings, "$.pool_state", "clean") WHERE id='${id}'`;
    await this.yp.await_query(sql);
    // console.log(`Entity created. type=${type} id=${id}, db_name=${db_name}`);
    return res;
  }

  /**
   * 
   * @param {*} reason 
   * @returns 
   */
  async delete_entity(reason) {
    const ident = this.get(Attr.ident);
    if (isEmpty(this.entity)) {
      console.error(`NOTHING TO DELETE`);
      return;
    }
    if (this.entity.id) {
      console.error(
        `DELETING ENTITY ID = ${this.entity.id} due to [${reason}]`
      );
      let node = await this.yp.await_proc("entity_delete", this.entity.id);
      check_safety(node.home_dir);
      console.log(`CLEANING UP ENTITY home_dir = ${node.home_dir}`);
      rmSync(node.home_dir, { recursive: true, force: true });
      throw `roll back on ${ident}`;
    }
  }

  /**
   * 
   * @returns 
   */
  async load_sql() {
    const { db_host } = this.entity;
    const { db_name } = this.entity;
    const type = this.get(Attr.type);

    const script =
      this.get("script") || resolve(__dirname, "template", `${type}.sql`);
    console.log(`Loading ${script} INTO ${db_name}...`);
    const { dbConnFlags } = require("./utils");
    const cmd = `/usr/bin/mariadb${dbConnFlags()} ${db_name} < ${script}`;

    const res = exec(cmd, { silent: true });
    if (res == null || res.code !== 0) {
      console.error(`FAILED TO RUN **${cmd}**`, res.stderr);
      return false;
    }

    return true;
  }
}

module.exports = __schema;
