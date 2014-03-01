process.stdin.setEncoding('utf8');
process.stdin.on('data', function(chunk) {
    console.log('got %d bytes of data', chunk.length);
});

process.on('message',function (m)
{
  console.log('child',m);
  process.send('ok');
});
