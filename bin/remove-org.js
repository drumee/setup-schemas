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
  const org = new Organization(args.domain_id);
  await org.remove()
}

start()
  .then(() => {
    exit(0);
  })
  .catch((e) => {
    console.error(e);
    exit(1);
  });

