#!/usr/bin/env node

const Organization = require("../lib/organization");
const args = require('./args')

const { getConfigs } = require("../lib/utils");
const { exit } = process;

const Configs = getConfigs();
if (!Configs) {
  console.error("Got invalid env data", Configs);
  exit(1);
}



/**
 *  * 
 *   */
async function start() {
  const org = new Organization();
  let opt = args;
  let domain = args.domain.split(/[./]+/)[0];
  console.log("AAA:24", args)
  // await org.createAdmin({
  // })
}

start()
  .then(() => {
    exit(0);
  })
  .catch((e) => {
    console.error(e);
    exit(1);
  });

