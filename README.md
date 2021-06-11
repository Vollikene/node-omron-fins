node-omron-fins
===============
## Overview
This is an implementation of the [OMRON FINS protocol](https://www.google.com/search?q=omron+fins+protocol+W342-E1-17) using Node.js. This library allows for rapid development of network based services that need to communicate with FINS capable devices. Utilizing the awesome asynchronous abilities of Node.js communication with large numbers of devices is very fast. UDP was chosen as the first variant of the protocol to be implemented because of its extremely low overhead and performance advantages. Although UDP is connectionless this library makes use of software based timeouts and transaction identifiers to allow for better reliability. 

This adaption of the library utilises a sequence manager to coordinate callbacks with data responses, providing the ability to clearly understand who called for data when the request returns. All of the commands (listed below) can be called not only with a callback (for determining who called) but can also except a `tag` of any type (typically an object or key) permitting further routing in the users callback. If the callback is omitted, the appropriate reply/timeout/error is emitted instead.

## Version Update Notes
This release (and possibly future releases up to V1.0.0) has breaking changes.
Where possible, I make every attempt to keep things compatible, but sometimes, it becomes obvious a better way is worth the trouble - it happens (sorry) :)
Semantic Versioning 2.0.0 will be followed after V1 however for now, where you see `V0.x.y`...
* `x` = major / minor change
* `y` = patch / bugfix


## Supported PLCs:
* CV
* CS
* CJ
* NJ
* NX
NOTE: Not all NX PLCs have FINS support.

## Supported Commands:

* Memory area read (Word and Bit)
* Memory area write (Word and Bit)
* Memory area fill
* Controller status read
* Run
* Stop


## Prerequisites
* [Node.js](http://howtonode.org/how-to-install-nodejs) (required) - Server side javascript runtime for Windows, Linux and Mac)
* [Wireshark](http://www.wireshark.org/download.html) (optional) - This will allow you to see and monitor FINS communication


## Install
As an example we will be making a directory for our example code and installing the module there:

```sh
mkdir helloFins
cd helloFins
npm init
npm install omron-fins
```

## Usage
Requiring the library:
```js
const fins = require('omron-fins');
```


Create a `FinsClient` object and pass it:
* `port` - FINS UDP port number as set on the PLC
* `ip` - IP address of the PLC
* `options` - An object containing necessary parameters `timeout`, `DNA`, `DA1`, `DA2`, `SNA`, `SA1`, `SA2` 
```js
const options = {timeout: 5000, SA1: 2, DA1: 1};
const IP = '192.168.0.2';
const PORT = 9600;
const client = fins.FinsClient(PORT, IP, options);
```

Add a reply listener. The `msg` parameters content will vary depending on the command issued. 

* `.sid` - Transaction identifier. Use this to track specific command/ response pairs.
* `.request` - An object containing values like the parsed `address` object and a string `functionName` 
* `.response` - An object containing the parsed values from the FINS command including the `remotehost`, `endCode` and `endCodeDescription`.
* `.error` - This will normally be `false`. `Check msg.response.*`  if `true`
* `.complete` - true if the command has completed
* `.values` - if the command returns values, they will be here
* `.stats` - performance information
* `.tag` - the tag value you sent (if any) with the command.
* `.timeout` - a boolean flag to indicate if a transaction timeout occurred

Example...
```js
client.on('reply', msg){
	console.log("Reply from           : ", msg.response.remoteHost);
	console.log("Sequence ID (SID)    : ", msg.sid);
	console.log("Operation requested  : ", msg.request.functionName);
	console.log("Response code        : ", msg.response.endCode);
	console.log("Response desc        : ", msg.response.endCodeDescription);
	console.log("Data returned        : ", msg.response.values || "");
	console.log("Round trip time      : ", msg.timeTaken + "ms");
	console.log("Your tag             : ", msg.tag);
});
```




Finally, call any of the supported commands! 




### Memory Area Read Command
`.read(address, count, callback, tag)`

* `address` - Memory area and the numerical start address e.g. `D100` or `CIO50.0`
* `count` - Number of registers to read
* `callback` - Optional callback `(err, msg) => {}` 
* `tag` - Optional tag item that is sent back in the callback method 

```js
 /* Read 10 registers starting from register 00000 in the DM Memory Area */
.read('D00000',10);

/* Same as above with callback */
client.read('D00000',10,function(err,bytes) {
	console.log("Bytes: ", bytes);
});
```

### Memory Area Write Command
`.write(address, dataToBeWritten, callback, tag)`

* `address` - Memory area and the numerical start address e.g. `D100` or `CIO50.0`
* `data` - An array of values or single value
* `callback` - Optional callback `(err, msg) => {}` 
* `tag` - Optional tag item that is sent back in the callback method 

```js
/* Writes single value of 1337 into DM register 00000 */
.write('D00000',1337)

/* Writes the values 12,34,56 into DM registers 00000 00001 000002 */
.write('D00000',[12,34,56]);

/* Writes 1 0 1 0 to DM0.4, DM0.5, DM0.6 & DM0.7 */
.write('D0.4',[true, false, 1, 0]);

/* Writes the values 12,34,56 into DM registers 00000 00001 000002 and calls back when done */
.write('D00000',[12,34,56], function(msg){
	//check msg.timeout and msg.error
	console.log(msg.response)
});


/* Same as above with callback */
.write('D00000',[12,34,56],function(err, msg) {
	console.log("seq: ", msg);
});
```

### Memory Area Fill Command
`.fill(address, value, regsToBeWritten, callback, tag)`

* `address` - Memory area and the numerical start address e.g. `D100` or `CIO50`
* `value` - Value to be filled
* `count` - Number of registers to write
* `callback` - Optional callback `(err, msg) => {}` 
* `tag` - Optional tag item that is sent back in the callback method 

```js

/* Writes 1337 in 10 consecutive DM registers from 00100 to 00110 */
.fill('D00100',1337,10);

/* Same as above with callback */
.fill('D00100',1337,10,function(err, msg) {
	console.log("msg: ", msg); 
});

/* Writes 1111 in 4 consecutive CIO bit registers from CIO5.0 to CIO5.3 */
.fill('CIO5.0',true,4);


```


### Change PLC to MONITOR mode
`.run(callback, tag)`

* `callback` - Optional callback `(err, msg) => {}` 
* `tag` - Optional tag item that is sent back in the callback method 

```js
/* Puts the PLC into Monitor mode */
.run(function(err, msg) {
  console.log(err, msg)
});
```

### Change PLC to PROGRAM mode
`.stop(callback, tag)`
* `callback` - Optional callback `(err, msg) => {}` 
* `tag` - Optional tag item that is sent back in the callback method 

```js

/* Stops program execution by putting the PLC into Program mode */
.stop(function(err, msg) {
	console.log(err, msg)
});

.stop();
```


### Get PLC Status
`.status(callback, tag)`

* `callback` - Optional callback `(err, msg) => {}` 
* `tag` - Optional tag item that is sent back in the callback method 

```js
.status(function(err, msg) {
  console.log(err, msg)
}, tag);

.status();
```

======

## Example applications

### Basic Example
A basic example that will show you how to read, write and fill data for a single client.

```js
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
```


### Multiple Clients  

**TODO: Test and update this demo following v0.2.0 breaking changes**

Example of instantiating multiple objects to allow for asynchronous communications. Because this code doesn't wait for a response from any client before sending/receiving packets it is incredibly fast. In this example we attempt to read a memory area from a list of remote hosts. Each command will either return with a response or timeout. Every transaction will be recorded to the `responses` array with the `ip` as a key and the `msg.response.values` as the associated value. 

If a timeout occurs and you have provided a callback, the `msg.timeout` flag will be set.
If a timeout occurs and you have not provided a callback, to can get a response by listening for `'timeout'` being emitted.
Once the size of the responses array is equal to the number of units we tried to communicate with we know we have gotten a response or timeout from every unit


```js
/* ***************** UNTESTED ***************** */

const fins = require('omron-fins');
const debug = true;
const clients = [];
const responses = {};

/* List of remote hosts can be generated from local or remote resource */
const remoteHosts = [
	{ KEY: "PLC1", IP:'192.168.0.1', OPTS: {DA1:1, SA1:99} },
	{ KEY: "PLC2", IP:'192.168.0.2', OPTS: {DA1:2, SA1:99} },
	{ KEY: "PLC3", IP:'192.168.0.3', OPTS: {DA1:3, SA1:99} },
];

/* Data is ready to be processed (sent to API,DB,etc) */
const finished = function(responses) {
	console.log("All responses and or timeouts received");
	console.log(responses);
};

const pollUnits = function() {

	/* We use number of hosts to compare to the length of the response array */
	const numberOfRemoteHosts = remoteHosts.length;
	const options = {timeout:2000};
	for (let remHost in remoteHosts) {

		/* Add key value entry into responses array */
		clients[remHost.KEY] = fins.FinsClient(9600,remHost.IP,remHost.OPTS);
		clients[remHost.KEY].on('reply', function(err, msg) {
			if(debug) console.log("Got reply from: ", msg.response.remotehost);

			/* Add key value pair of [ipAddress] = values from read */
			responses[msg.response.remotehost] = msg.response.values;
			
			/* Check to see size of response array is equal to number of hosts */
			if(Object.keys(responses).length == numberOfRemoteHosts){
				finished(responses);
			}
		});

		/* If timeout occurs log response for that IP as null */
		clients[remHost.KEY].on('timeout',function(host, msg) {
			responses[host] = null;
			if(Object.keys(responses).length == numberOfRemoteHosts){
				finished(responses);
			};
			if(debug) console.log("Got timeout from: ", host);
		});

		clients[remHost.KEY].on('error',function(err, msg) {
			//depending where the error occurred, seq may contain relevant info
			console.error(err)
		});

		/* Read 10 registers starting at DM location 00000 */
		clients[remHost.KEY].read('D00000',10);

	};
};

console.log("Starting.....");
pollUnits();

```

### Logging Data & Troubleshooting
If you have Wireshark installed it is very simple to analyse OMRON FINS/UDP traffic:

Simply select your network interface and then hit "Start"
![Interface](http://i.imgur.com/9K8u9pB.png "Select interface and hit start")

Once in Wireshark change your filter to "omron"
![Filter](http://i.imgur.com/j3GxeJn.png "Change filter")

Now you can examine each FINS packet individually
![Filter](http://i.imgur.com/3Wjpbqf.png "Examine Packet")

