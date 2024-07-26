#!/usr/bin/env node
const { Messenger, sysEnv } = require("@drumee/server-essentials");
const { domain, data_dir } = sysEnv();
let { ADMIN_EMAIL } = process.env;
const { join } = require("path");
const { readFileSync } = require("fs");

global.debug = 5;
async function sendEmail() {
  let email = ADMIN_EMAIL || `butler@${domain}`;
  email = email.trim();
  if (!email.isEmail()) {
    console.log("Invalid email")
    return;
  }

  let welcome = join(data_dir, 'tmp', "welcome.html");
  let str = readFileSync(welcome);
  const msg = new Messenger({
    html: String(str).toString(),
    subject: 'Installation completed',
    recipient: email,
    handler: (e) => {
      console.warn("Failed to send message", e)
    },
  });

  await msg.send();
  console.log(`An email was sent to ${email}. Please check spam folder if you don't receive it.
  Anyway, you can open the file from ${welcome} to set the admin password of your Drumee Hub`)
}

sendEmail().then(() => {
  process.exit(0);
})
