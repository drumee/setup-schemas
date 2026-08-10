const { ArgumentParser } = require('argparse');
function parseArgs() {
  const parser = new ArgumentParser({
    description: 'Drumee schemas utils',
    addHelp: true
  });
  parser.addArgument('--dommain-ident', {
    type: String,
    help: 'Domain name [example.com]'
  });
  parser.addArgument('--email', {
    type: String,
    help: 'User email'
  });
  parser.addArgument('--firstname', {
    type: String,
    help: 'User firstname'
  });
  parser.addArgument('--lastname', {
    type: String,
    help: 'User lastname'
  });
  return parser.parseArgs();
}
const args = parseArgs();
module.exports = args;
