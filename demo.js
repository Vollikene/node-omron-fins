const fins = require('./lib/index');  // << use this when running from src
//const fins = require('omron-fins'); // << use this when running from npm

// Connecting to remote FINS client on port 9600 with timeout of 2s.
// PLC is expected to be at 192.168.1.120 and this PC is expected to be fins node 36 (adjust as required)
const client = fins.FinsClient(9600,'192.168.1.120', {SA1:36, DA1:120, timeout: 2000});

// Setting up our error listener
client.on('error',function(error, msg) {
  console.log("Error: ", error, msg);
});
// Setting up our timeout listener
client.on('timeout',function(host, msg) {
  console.log("Timeout: ", host);
});

// Setting up the general response listener showing a selection of properties from the `msg`
client.on('reply',function(msg) {
  console.log("############# client.on('reply'...) #################")
	console.log("Reply from           : ", msg.response.remoteHost);
	console.log("Sequence ID (SID)    : ", msg.sid);
	console.log("Operation requested  : ", msg.request.functionName);
	console.log("Response code        : ", msg.response.endCode);
	console.log("Response desc        : ", msg.response.endCodeDescription);
	console.log("Data returned        : ", msg.response.values || "");
	console.log("Round trip time      : ", msg.timeTaken + "ms");
	console.log("Your tag             : ", msg.tag);
  console.log("#####################################################")
});

// Read 10 registers starting at DM register 0
// a "reply" will be emitted - check general client reply on reply handler
console.log("Read 10 WD from D0")
client.read('D0',10, null, {"tagdata":"I asked for 10 registers from D0"});
console.log("Read 32 bits from D0.0")
client.read('D0.0',32, null, {"tagdata":"I asked for 32 bits from D0.0"}); 


// direct callback is useful for getting direct responses to direct requests
var cb = function(err, msg) {
  console.log("################ DIRECT CALLBACK ####################")
  if(err)
    console.error(err);
  else
	  console.log(msg.request.functionName, msg.tag || "", msg.response.endCodeDescription);
	console.log("#####################################################")
};


//example fill D700~D704 with 123 & the callback `cb` for the response
console.log("Fill D700~D709 with 123 - direct callback expected")
client.fill('D700',123, 10, cb, "set D700~D709 to 123");

//example Read D700~D709 with the callback `cb` for the response
console.log("Read D700~D709 - direct callback expected")
client.read('D700',10, cb, "D700~D709")


//example write 1010 1111 0000 0101 to D700.0~D700.15 - response will be sent to client 'reply' handler
client.write('D700.0', [true, false, 1, 0,    "true", true, 1, "1",    "false", false, 0, "0",    0, 1, 0,  1], null, "write 1010 1111 0000 0101 to D700");
client.read('D700.0',16, null, "read D700.0 ~ D700.15 - should contain 1010 1111 0000 0101");


//example tagged data for sending with a status request
const tag = {"source": "system-a", "sendto": "system-b"}; 
getStatus(tag);


function getStatus(_tag) {
  console.log("Get PLC Status...")
  client.status(function(err, msg) {
    if(err) {
      console.error(err, msg);
    } else {
      //use the tag for post reply routing or whatever you need
      console.log(msg.response, msg.tag);
    }
  }, _tag);
}


setTimeout(() => {
  console.log("Request PLC change to STOP mode...")
  client.stop((err, msg) => {
    if(err) {
      console.error(err)
    } else {
      console.log("should be stopped")
      setTimeout(() => {
        getStatus();
      }, 150);
    }
  })
}, 500);


setTimeout(() => {
  console.log("Request PLC change to RUN mode...")
  client.run((err, msg) => {
    if(err) {
      console.error(err)
    } else {
      console.log("should be running again")
      setTimeout(() => {
        getStatus();
      }, 150);
    }
  })
}, 2000);