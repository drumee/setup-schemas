#!/usr/bin/env node
const { join } = require("path");
const {
  create_user,
  get_tmpdb,
  drop_tmpdb
} = require("./lib/utils");

const Organization = require("./lib/organization");
const Mfs = require("./lib/mfs");
const CREDENTIAL_DIR = "/etc/drumee/credential";
const POSTFIX_CREDENTIAL = join(CREDENTIAL_DIR, "postfix.json");
const DB_CREDENTIAL = join(CREDENTIAL_DIR, "db.json");
const publicKeyFile = join(CREDENTIAL_DIR, "crypto/public.pem");
const privateKeyFile = join(CREDENTIAL_DIR, "crypto/private.pem");
const {
  Mariadb, subtleCrypto, Cache, Template, uniqueId
} = require("@drumee/server-essentials");
const { existsSync } = require("fs");

const { getConfigs } = require("./lib/utils");
const { exit } = process;

const Configs = getConfigs();
if (!Configs) {
  console.error("Got invalid env data", Configs);
  exit(1);
}
const { data_dir } = Configs;
/**
 *
 */
async function prepare() {
  const { readFileSync, writeFileSync } = require("jsonfile");
  const JSON_OPT = { spaces: 2, EOL: "\r\n" };
  let name = get_tmpdb();
  if (!name) {
    throw "Failed to connect to database server";
  }
  let conf;
  if (existsSync(DB_CREDENTIAL)) {
    conf = readFileSync(DB_CREDENTIAL);
    create_user(conf);
  } else {
    console.log("Credentials not found from", DB_CREDENTIAL);
    conf = { 
      user: "drumee-app", 
      host: "localhost",
      password:uniqueId()
    }
    create_user(conf);
    writeFileSync(DB_CREDENTIAL, conf, JSON_OPT);
  }

  if (existsSync(POSTFIX_CREDENTIAL)) {
    let conf = readFileSync(POSTFIX_CREDENTIAL);
    create_user(conf, 'mailserver');
  }

  let db = new Mariadb({ name });
  let seq1 = await db.await_query("SELECT 'app user now ready' AS status");
  console.log(`Testing connection to db ${name}`, seq1);
  drop_tmpdb(name);
  db.end();
}



/**
 * 
 */
async function afterInstall(link, domain) {
  const { generateKeysPair } = subtleCrypto;
  const { writeFileSync } = require("fs");
  let args = await generateKeysPair();
  let { publicKey, privateKey } = args;
  writeFileSync(publicKeyFile, publicKey);
  writeFileSync(privateKeyFile, privateKey);
  let out = join(data_dir, 'tmp', "welcome.html");
  let tpl = join(__dirname, 'asset', "welcome.html");
  console.log(`Cteating welcome file into ${out}`);
  Template.write({ link, domain }, { tpl, out });
}

/**
 * 
 */
async function start() {
  await prepare();
  new Cache();
  await Cache.load();
  const org = new Organization();
  await org.populate();
  await org.createNobody();
  await org.createGuest();
  const { media } = await org.createSystemUser();
  const { reset_link, domain } = await org.createAdmin(media);
  let { db_name } = media;
  let mfs = new Mfs({ db_name });
  await mfs.importContent("content.drumee.com/Wallpapers",);
  await mfs.importTutorial();
  await afterInstall(reset_link, domain)
}

start()
  .then(() => {
    exit(0);
  })
  .catch((e) => {
    console.error(e);
    exit(1);
  });
