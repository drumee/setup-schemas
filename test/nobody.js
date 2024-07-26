
// let dbConf = require('../configs')();
// console.log("DB CONF IS", dbConf);
const User = require("../user");

const { getConfigs } = require("../utils");
const { exit } = process;

const Configs = getConfigs();
if (!Configs) {
  console.error("Got invalid env data", Configs);
  exit(1);
}

/**
 * 
 */
async function start() {
  let u = new User(Configs);
  await u.createNobody();

}
start().then(()=>{
  //console.log({Configs})
  process.exit(0);
})
