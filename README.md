node-omron-fins
===============
### Overview
This is an implementation of the [OMRON FINS protocol](https://www.google.com/search?q=omrin+fins&oq=omrin+fins&aqs=chrome..69i57j0l5.945j0j7&sourceid=chrome&es_sm=93&ie=UTF-8#q=omron+fins&spell=1) using Node.js. This library allows for rapid development of network based services that need to communicate with FINS capable devices. Utilizing the awesome asynchronous abilities of Node.js communication with large numbers of devices is very fast. UDP was chosen as the first variant of the protocol to be implemented because of its extremely low overhead and performance advantages. Although UDP is connectionless this library makes use of software based timeouts and transaction identifiers to allow for better reliability. 


### Supported Commands:

* Memory area read
* Memory area write
* Memory area fill
* Controller status read
* Run
* Stop



### Prerequisites
* [Install Node.js](http://howtonode.org/how-to-install-nodejs) (Contains installation instructions for Windows, Linux and Mac)
* [Install Wireshark](http://www.wireshark.org/download.html) (This will allow you to see monitor FINS communication)



### Install
As an example we will be making a directory for our example code and installing the module there:
```sh
mkdir helloFins
cd helloFins
npm install git://github.com/patrick--/node-omron-fins.git
```

### Usage
Requiring the library:
```js
var fins = require('omron-fins');
```


Create a `FinsClient` object and pass it:
*  `port`
* `ip`
* `options` array with timeout value in ms. (default timeout is 2 seconds) 
```js
var options = {timeout:10000};
var client = fins.FinsClient(9600,'127.0.0.1');
```

Add a reply listener. Response object content will vary depending on the command issued. However all responses are guaranteed to contain the following information:


* `.sid` - Transaction identifier. Use this to track specific command/ response pairs.
* `.command` - The issued command code.
* `.response` - The response code returned after attempting to issue a command.
* `.remotehost` - The IP address the response was sent from.

```js
client.on('reply',msg){
	console.log('SID: ', msg.sid);
	console.log('Command Code: ', msg.command);
	console.log('Response Code: ', msg.response);
	console.log('Remote Host: ', msg.remotehost);
});
```




Finally, call any of the supported commands! 




##### .read(address, regsToRead, callback, tag)
Memory Area Read Command 
* `address` - Memory area and the numerical start address
* `regsToRead` - Number of registers to read
* `callback` - Optional callback method 
* `tag` - Optional tag item to send in callback method 

```js
 /* Reads 10 registers starting from register 00000 in the DM Memory Area */
.read('D00000',10);

/* Same as above with callback */
client.read('D00000',10,function(err,bytes) {
	console.log("Bytes: ", bytes);
});
```

##### .write(address, dataToBeWritten, callback, tag)
Memory Area Write Command
* `address` - Memory area and the numerical start address
* `dataToBeWritten` - An array of values or single value
* `callback` - Optional callback method 
* `tag` - Optional tag item to send in callback method 

```js
/* Writes single value of 1337 into DM register 00000 */
.write('D00000',1337)

/* Writes the values 12,34,56 into DM registers 00000 00001 000002 */
.write('D00000',[12,34,56]);

/* Writes the values 12,34,56 into DM registers 00000 00001 000002 and callsback when done */
.write('D00000',[12,34,56], function(seq){
	//check seq.timeout and seq.error
	console.log(seq.response)
});


/* Same as above with callback */
.write('D00000',[12,34,56],function(err,bytes) {
	console.log("Bytes: ", bytes);
});
```

##### .fill(address, dataToBeWritten, regsToBeWritten, callback, tag)
Memory Area Fill Command
* `address` - Memory area and the numerical start address
* `dataToBeWritten` - Two bytes of data to be filled
* `regsToBeWritten` - Number of registers to write
* `callback` - Optional callback method
* `tag` - Optional tag item to send in callback method 
```js

/* Writes 1337 in 10 consecutive DM registers from 00100 to 00110 */
.fill('D00100',1337,10);


/* Sames as above with callback */
.fill('D00100',1337,10,function(err,bytes) {
	console.log("Bytes: ", bytes); 
});


```


##### .run(callback, tag)
RUN
* `callback` Optional callback
* `tag` - Optional tag item to send in callback method 
```js
/* Puts into Monitor mode */
.run(function(err,bytes) {

});


```

##### .stop(callback, tag)
STOP
* `callback` Optional callback
* `tag` - Optional tag item to send in callback method 

```js

/* Stops program excution by putting into Program mode */
.stop(function(err,bytes) {

});

.stop();
```



======


### Basic Example
Bare bones example that will show you how to read data from a single client.

```js
var fins = require('omron-fins');
var fins = require('.');

// Connecting to remote FINS client on port 9600 with default timeout value.
// PLC is expected to be at 192.168.0.2 and this PC is expected to be node 1
var client = fins.FinsClient(9600,'192.168.0.2', {SA1:1});

// Setting up our error listener
client.on('error',function(error) {
  console.log("Error: ", error);
});

// Setting up the genral response listener
// Showing a selection of properties of a sequence response
client.on('reply',function(seq) {
	console.log("Reply from: ", seq.remotehost);
	console.log("Sequence ID (SID): ", seq.sid);
	console.log("Operation requested: ", seq.request.functionName);
	console.log("Response code: ", seq.response.endCode);
	console.log("Response desc: ", seq.response.endCodeDescription);
	console.log("Data returned: ", seq.response.values);
	console.log("Round trip time: ", seq.stats.runtimeMS);
	console.log("Your tag: ", seq.tag);
});

client.on('reply',function(sequence) {
	console.log(sequence)
});

// Read 10 registers starting at DM register 0
// a "reply" will be emitted - check general client reply on reply handler
client.read('D0',10); 

// Read 10 registers starting at DM register 10 & callback with my tagged item upon reply from PLC
// direct callback is usefull for getting direct responses to direct requests
var cb = function(seq) {
	console.log("############# DIRECT CALLBACK #################")
	console.warn(seq);
	console.log("###############################################")
};
client.read('D10',10, cb, new Date());

client.close();

```


### Multiple Clients  

**TODO: Test and update this demo following v0.2.0 breaking changes**

Example of instantiating multiple objects to allow for asynchronous communications. Because this code doesn't wait for a response from any client before sending/receiving packets it is incredibly fast. In this example we attempt to read a memory area from a list of remote hosts. Each command will either return with a response or timeout. Every transaction will be recorded to the `responses` array with the `ip` as a key and the `seq.response.values` as the associated value. 

If a timeout occurs and you have provided a callback, the `seq.timeout` flag will be set.
If a timeout occurs and you have not provided a callback, to can get a response by listening for `'timeout'` being emitted.
Once the size of the responses array is equal to the number of units we tried to communicate with we know we have gotten a response or timeout from every unit


```js
/* ***************** UNTESTED ***************** */

var fins = require('omron-fins');
var debug = true;
var clients = [];
var responses = {};

/* List of remote hosts can be generated from local or remote resource */
var remoteHosts = [
	{ KEY: "PLC1", IP:'192.168.0.1', OPTS: {DA1:1, SA1:99}),
	{ KEY: "PLC2", IP:'192.168.0.2', OPTS: {DA1:2, SA1:99}),
	{ KEY: "PLC3", IP:'192.168.0.3', OPTS: {DA1:3, SA1:99}),
];

/* Data is ready to be processed (sent to API,DB,etc) */
var finished = function(responses) {
	console.log("All responses and or timeouts received");
	console.log(responses);
};

var pollUnits = function() {

	/* We use number of hosts to compare to the length of the response array */
	var numberOfRemoteHosts = remoteHosts.length;
	var options = {timeout:2000};
	for (var remHost in remoteHosts) {

		/* Add key value entry into responses array */
		clients[remHost.KEY] = fins.FinsClient(9600,remHost.IP,remHost.OPTS);
		clients[remHost.KEY].on('reply',function(seq) {
			console.log("Got reply from: ", seq.response.remotehost);

			/* Add key value pair of [ipAddress] = values from read */
			responses[seq.response.remotehost] = seq.response.values;
			
			/* Check to see size of response array is equal to number of hosts */
			if(Object.keys(responses).length == numberOfRemoteHosts){
				finished(responses);
			}
		});

		/* If timeout occurs log response for that IP as null */
		clients[remHost.KEY].on('timeout',function(host, seq) {
			responses[host] = null;
			if(Object.keys(responses).length == numberOfRemoteHosts){
				finished(responses);
			};
			if(debug)
				console.log("Got timeout from: ", host);
		});

		clients[remHost.KEY].on('error',function(error, seq) {
			//depending where the error occured, seq may contain relevant info
			console.log("Error: ", error)
		});

		/* Read 10 registers starting at DM location 00000 */
		clients[remHost.KEY].read('D00000',10);

	};
};

console.log("Starting.....");
pollUnits();

```

### Logging Data & Troubleshooting
Once you have Wirshark installed it is very simple to analyze your OMRON FINS traffic:

Simply select your network interface and then hit "Start"
![Interface](http://i.imgur.com/9K8u9pB.png "Select interface and hit start")

Once in Wireshark change your filter to "omron"
![Filter](http://i.imgur.com/j3GxeJn.png "Change filter")

Now you can examine each FINS packet individually
![Filter](http://i.imgur.com/3Wjpbqf.png "Examine Packet")

