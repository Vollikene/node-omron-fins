/* ***************** UNTESTED ***************** */

var fins = require('omron-fins');
var debug = true;
var clients = [];
var responses = {};

/* List of remote hosts can be generated from local or remote resource */
var remoteHosts = [
	{ KEY: "PLC1", IP:'192.168.0.1', OPTS: {DA1:1, SA1:99} },
	{ KEY: "PLC2", IP:'192.168.0.2', OPTS: {DA1:2, SA1:99} },
	{ KEY: "PLC3", IP:'192.168.0.3', OPTS: {DA1:3, SA1:99} },
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
		clients[remHost.KEY].on('reply', function(seq) {
			if(debug) console.log("Got reply from: ", seq.response.remotehost);

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
			if(debug) console.log("Got timeout from: ", host);
		});

		clients[remHost.KEY].on('error',function(error, seq) {
			//depending where the error occured, seq may contain relevant info
			console.error(error)
		});

		/* Read 10 registers starting at DM location 00000 */
		clients[remHost.KEY].read('D00000',10);

	};
};