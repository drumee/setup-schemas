// ======================================================
//
// ======================================================

const { exec } = require("shelljs");
const { isEmpty, isArray, max } = require('lodash');
const { mkdirSync, readdirSync } = require("fs");
const { resolve, join } = require("path");
const { sysEnv, uniqueId } = require("@drumee/server-essentials");
const GRANTS =
  "SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, PROCESS, REFERENCES, INDEX, ALTER, CREATE TEMPORARY TABLES, LOCK TABLES, EXECUTE, EVENT, TRIGGER, CREATE TABLESPACE, REPLICATION CLIENT, SLAVE MONITOR";

const DB_CONF = "/etc/drumee/credential/db.json";

let {
  DRUMEE_DESCRIPTION,
  FIRSTNAME,
  LASTNAME,
  ADMIN_EMAIL,
  DRUMEE_DOMAIN_NAME
} = process.env;

const defaultConf = {
  schemas_dir: '/opt/drumee/schemas',
  data_dir: '/data',
  import_dir: '/exchangearea/import',
  export_dir: '/exchangearea/export',
  domain_desc: DRUMEE_DESCRIPTION || "My Drumee Cloud",
  domain: DRUMEE_DOMAIN_NAME,
  firstname: FIRSTNAME,
  lastname: LASTNAME,
  email: ADMIN_EMAIL
}

const MEDIA_HUBNAME = uniqueId();

/**
 * 
 */
function getConfigs() {
  //let {data} = readFileSync(INSTALL_ENV);
  let env = sysEnv(); //readFileSync(SYS_ENV);
  let data = { ...defaultConf, ...env };
  data.domain_desc || data.company_name || data.domain_desc;
  if (!data || !data.domain_name) {
    console.error(data);
    return null;
  }

  data.media_hubname = MEDIA_HUBNAME;
  data.media_vhost = `${MEDIA_HUBNAME}.${data.domain}`;
  data.wallpapers_path = "/Wallpapers";
  return data;
}

/**
 * 
 */
function shellExec(cmd, throwOnFail = true) {
  let r = exec(cmd);
  if (r.code === 0) {
    return true;
  }
  console.error("Failed to run", `**${cmd}**`);
  if (throwOnFail) {
    throw r.stderr
  }
  return false;
}

/**
 * 
 * @param {*} l 
 * @returns 
 */
function randomString(l = 16) {
  let crypto = require("crypto");
  return crypto.randomBytes(16).toString('base64').replace(/[\+\/=]+/g, '');
};

/**
 * 
 */
function runSql(sql, flag = "-e") {
  let r = exec(`mariadb ${flag} "${sql}"`);
  if (r.code === 0) {
    return true;
  }
  console.error("Failed to run", `**${sql}**`, r.stderr);
  return false;
}


/**
 *
 * @returns
 */
async function makeSchemasTemplates() {

  let { schemas_dir } = getConfigs();
  let base = resolve(schemas_dir, "seed");
  console.log(`Drumee Schemas Populating(${base})`);
  let dirs = readdirSync(base);
  let i = 0;
  let length = dirs.length;
  console.log(`Initializing schemas... Please wait.`);
  let timer = setInterval(function () {
    process.stdout.write(`o`);
  }, 1000);
  for (let name of dirs.reverse()) {
    let db_name = name.replace(/\.sql$/, "");
    if (!/\.sql$/i.test(name)) continue;
    i++;
    if (!runSql(`CREATE DATABASE IF NOT EXISTS ${db_name}`)) {
      throw `Failed to create database ${db_name}`;
    }

    let file = resolve(base, name);
    let cmd = `mariadb ${db_name} < ${file}`;
    process.stdout.write(`${db_name} (${i}/${length})\r`);
    shellExec(cmd, true);
  }
  clearInterval(timer);
}

/**
 *
 */
function ensure_app_user(json) {
  let user = json.user;
  let cmd;
  if (json.password) {
    cmd = `mariadb -u${user} -p${json.password} -e "SELECT 'user ${user} uses password'"`;
  } else {
    cmd = `mariadb -u${user} -e "SELECT user ${user} uses socket"`;
  }
  let r = exec(cmd);
  if (r.code === 0) {
    return true;
  }
  console.log("Current password is invalid. No worrie. Recreate user with current credentials", json.user);
  return reset_user(json);
}


/**
 *
 */
function user_exists(json) {
  let cmd = `mariadb -e "SELECT user FROM mysql.user WHERE user='${json.user}' AND host='${json.host}'"`;
  let r = exec(cmd);
  //console.log("AAACMD:", r);
  if (r.code === 0 && r.stdout != "") {
    return true;
  }
  return false;
}

/**
 *
 */
function grant_privilege(json, db = '*') {
  let user = `'${json.user}'@'${json.host}'`;
  let cmd;
  if (db == '*') {
    cmd = `mariadb -e "GRANT ${GRANTS} ON *.* TO ${user}"`;
  } else if (db) {
    cmd = `mariadb -e "GRANT ALL PRIVILEGES ON ${db}.* TO ${user}"`;
  }
  r = exec(cmd);
  if (r.code !== 0) {
    console.warn("Failed to run ", cmd, r);
    return false;
  }

  return true;
}



/**
 *
 */
function reset_user(json) {
  let user = `'${json.user}'@'${json.host}'`;
  let cmd = `mariadb -e "DROP USER IF EXISTS ${user}"`;

  r = exec(cmd);
  if (r.code !== 0) {
    throw r.stderr;
  }
  return create_user(json)
}

/**
 *
 */
function create_user(json) {
  json.host = json.host || 'localhost';
  let user = `'${json.user}'@'${json.host}'`;
  let cmd = null;
  let r;
  if (json.password) {
    cmd = `mariadb -e "CREATE OR REPLACE USER ${user} IDENTIFIED BY '${json.password}'"`;
  } else {
    cmd = `mariadb -e "CREATE OR REPLACE USER ${user} IDENTIFIED VIA unix_socket"`;
  }
  r = exec(cmd);
  if (r.code === 0) {
    return grant_privilege(json);
  }
  console.error("Error code:", r.stderr);
  console.log(`Failed to create application DB user ${user}.
    You may configure this manually later by editing /${DB_CONF}`);
}


/**
 *
 * @param {*} json
 * @returns
 */
function update_user(json) {
  if (!json.user || !json.host) {
    console.error("Invalid user data", json);
    return false;
  }
  let user = `'${json.user}'@'${json.host}'`;

  if (!user_exists(json)) {
    console.error("Cannot update non existing user", json);
    return false;
  }

  let cmd;

  if (isEmpty(json.password) || ['localhost', '127.0.0.1'].includes(json.host)) {
    cmd = `ALTER USER ${user} IDENTIFIED VIA unix_socket`;
  } else {
    cmd = `mariadb -e "ALTER USER IF EXISTS ${user} IDENTIFIED BY '${json.password}'"`;
  }

  let r = exec(cmd);

  if (r.code === 0) {
    return grant_privilege(json);
  }

  console.log(`Failed to update application DB user ${user}.
  You may configure this manually later by editing /${DB_CONF}`);
  return false;
}


/**
 * 
 */
function get_tmpdb() {
  let name = 'test_' + randomString();
  let cmd = `mariadb -e "show databases like '${name}'"`;
  let o = exec(cmd);
  let i = 0;
  if (o.code !== 0) {
    //console.error("ERROR:", stderr);
    return null;
  }

  while (!isEmpty(o.stdout) && i < 100) {
    name = name = 'test_' + randomString();
    cmd = `mariadb -e "show databases like '${name}'"`;
    o = exec(cmd);
    i++;
  }

  console.log(`Creating tmp db ${name}`);
  cmd = `mariadb -e "create database ${name}"`;
  o = exec(cmd);
  if (o.code !== 0) {
    //console.error("ERROR:", stderr);
    return null;
  }

  return name;
}

/**
 * 
 */
function drop_tmpdb(name) {
  let cmd = `mariadb -e "drop database if exists ${name}"`;
  let o = exec(cmd);
}

/**
 *
 * @param {*} dirname
 */
function mkdir(dirname) {
  return mkdirSync(dirname, { recursive: true });
}


/**
 * 
 */
function debug(...args) {
  if (!process.env.DEBUG) return;
  console.log(...args);
}

/**
 * 
 * @param {*} text 
 * @param {*} top 
 * @param {*} bottom 
 */
function banner(text = "", top = 0, bottom = 0) {
  if (!process.env.DEBUG) return;
  let l = text.length;

  if (isArray(text)) {
    l = max(text.map(function (e) { return e.length }));
  } else {
    text = [text];
  }
  let b = ''.padStart(l + 20, "-");
  if (top) console.log("");
  console.log(" " + b);
  for (let t of text) {
    console.log('|' + t.padStart(l + 10, " ") + '|'.padStart(11, " "));
  }
  console.log(" " + b);
  if (bottom) console.log("");
}

/**
 * 
 * @param {*} text 
 */
function writeLine(text = "") {
  let l = process.stdout.colum - 2;
  if (l > 120) l = Math.max(l - 20, 100);
  process.stdout.write("".padStart(l, " ") + '\r');
  process.stdout.write(text.padStart(l, " ") + '\r');
}


module.exports = {
  banner,
  create_user,
  debug,
  drop_tmpdb,
  ensure_app_user,
  get_tmpdb,
  getConfigs,
  grant_privilege,
  makeSchemasTemplates,
  mkdir,
  randomString,
  reset_user,
  runSql,
  shellExec,
  update_user,
  user_exists,
  writeLine,
};
