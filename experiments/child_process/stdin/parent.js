var cp = require('child_process'), grunt= require('grunt');

var n = cp.fork(__dirname + '/child.js', { silent: true });
var time= process.hrtime();

n.on('message', function(m) {
  var diff= process.hrtime(time),
      secs= Math.round((diff[0]*1e9+diff[1])/1e9);
  console.log('elapsed secs: ',secs);
});
n.stdout.pipe(process.stdout);
n.stdin.on('drain',
function ()
{
  n.send('ok');
});
console.log('sending');
n.stdin.write(grunt.file.read('y'));
