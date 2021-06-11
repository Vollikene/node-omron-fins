const dgram = require('dgram');
const inherits = require('util').inherits;
const EventEmitter = require('events').EventEmitter;
const constants = require('./constants');
const SequenceManager = require('./SequenceManager');
const FinsAddressUtil = require('./FinsAddressUtil');
const {normaliseBool, boolsToBytes, wordsToBytes, buildPacket, getKeyName, isInt} = require('./data_utilities');

module.exports = FinsClient;

function FinsClient(port, host, options) {
    if (!(this instanceof FinsClient)) return new FinsClient(port, host, options);
    EventEmitter.call(this);
    this.init(port, host, options);
}

inherits(FinsClient, EventEmitter);


FinsClient.prototype.init = function (port, host, options) {
    /** @type {FinsClient}*/ const self = this;
    const defaultHost = constants.DefaultHostValues;
    const defaultOptions = constants.DefaultOptions;
    self.port = port || defaultHost.port;
    self.host = host || defaultHost.host;
    self.options = options || {};
    self.options.MODE = self.options.MODE || "CS";
    self.timeout = (self.options.timeout) || defaultOptions.timeout || 2000;
    self.max_queue = (self.options.max_queue) || defaultOptions.max_queue || 100;
    /** @type {FinsAddressUtil} */ self.finsAddresses = new FinsAddressUtil(self.options.MODE);

    //self.sequenceManager = new SequenceManager(self, { timeoutMS: this.timeout });
    this.sequenceManager = SequenceManager({ timeoutMS: this.timeout }, function(err, seq) {
        if(err) {
            self.emit("error", err, seq);
        }
    });

    //cleanup (if reconnecting, socket might be initialised)
    if (self.socket) {
        self.socket.removeAllListeners();
        delete self.socket;
    }
    /** @type {dgram.Socket} */
    self.socket = dgram.createSocket('udp4');

    self.header = Object.assign({}, constants.DefaultFinsHeader);
    self.header.ICF = isInt(self.options.ICF, constants.DefaultFinsHeader.ICF);
    self.header.DNA = isInt(self.options.DNA, constants.DefaultFinsHeader.DNA);
    self.header.DA1 = isInt(self.options.DA1, constants.DefaultFinsHeader.DA1);
    self.header.DA2 = isInt(self.options.DA2, constants.DefaultFinsHeader.DA2);
    self.header.SNA = isInt(self.options.SNA, constants.DefaultFinsHeader.SNA);
    self.header.SA1 = isInt(self.options.SA1, constants.DefaultFinsHeader.SA1);
    self.header.SA2 = isInt(self.options.SA2, constants.DefaultFinsHeader.SA2);
    self.header.incrementSID = function() {
        this.SID = (Math.abs(this.SID) % 254) + 1;
        return this.SID;
    }
    self.header.build = function() {
        var builtHeader = [
            this.ICF,
            this.RSV,
            this.GCT,
            this.DNA,
            this.DA1,
            this.DA2,
            this.SNA,
            this.SA1,
            this.SA2,
            this.SID
        ];
        return builtHeader;
    };

    self.connected = false;
    self.requests = {};
    self.emit('initialised', self.options);

    function receive(buf, rinfo) {
        //console.warn("receive", buf)
        var response = _processReply(buf, rinfo, self.sequenceManager);
        if (response) {
            //console.warn(response.sid, "receive", response)
            self.sequenceManager.done(response.sid);//1st, cancel the timeout
            var seq = self.sequenceManager.get(response.sid);//now get the sequence
            if (seq) {
                seq.response = response;
                var request = seq.request;
                if (request && request.callback) {
                    request.callback(null, seq);
                } else {
                    self.emit('reply', seq);
                }
                self.sequenceManager.remove(response.sid);
            }
        } else {
            err = new Error("Unable to process the PLC reply");
            self.emit('error', err);
        }
    }

    function initialised() {
        self.emit('initialised');
        self.connected = true;
    }
    function listening() {
        self.emit('open');
        self.connected = true;
    }

    function close() {
        self.emit('close');
        self.connected = false;
    }

    function error(err) {
        self.emit('error', err);
    }

    self.socket.on('message', receive);
    self.socket.on('listening', listening);
    self.socket.on('close', close);
    self.socket.on('error', error);

};

FinsClient.prototype.reconnect = function () {
    /** @type {FinsClient}*/ const self = this;
    self.init(self.port, self.host, self.options);
};

/**
 * This callback is displayed as a global member.
 * @callback commandCallback
 * @param {*} err - Error (if any)
 * @param {object} msg - The msg object containing the `request`, `response`, `tag` and more.
 */

/**
 * Memory Area Read Command
 * @param {string} address - Memory area and the numerical start address e.g. `D100` or `CIO50.0`
 * @param {number} count - Number of registers to read
 * @param {commandCallback} [callback=null] - Optional callback method `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns the SID of the request (returns `null` if any of the command parameters are invalid).
 */
FinsClient.prototype.read = function (address, count, callback, tag) {
    /** @type {FinsClient}*/ const self = this;
    if (self.queueCount() >= self.max_queue) {
        // console.warn("queue count exceeded")
        self.emit('full');
        return null;
    }
    const memoryAddress = self.finsAddresses.stringToAddress(address);
    const addressData = self.finsAddresses.addressToBytes(memoryAddress);
    if (!addressData) {
        _sendParamError("address is invalid", callback, {tag: tag});
        return null;
    }
    if (!count) {
        _sendParamError("count is empty", callback, {tag: tag});
        return null;
    }
    const SID = self.header.incrementSID();
    const header = self.header.build();
    const command = constants.Commands.MEMORY_AREA_READ;
    const commandData = [addressData, wordsToBytes(count)];
    const packet = buildPacket([header, command, commandData]);
    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        functionName: "read",
        address: memoryAddress,
        count: count,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, _req, tag);
    return SID;
};

/**
 * Memory Area Write Command.
 * @param {string} address - Memory area and the numerical start address e.g. `D100` or `CIO50.0`
 * @param {number} data - Data to write. This can be 1 value or an array values. For WD addresses, data value(s) should be 16 bit integer. For BIT addresses, data value(s) should be boolean or 1/0.
 * @param {commandCallback} [callback=null] - Optional callback method `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns the SID of the request (returns `null` if any of the command parameters are invalid).
 */
FinsClient.prototype.write = function (address, data, callback, tag) {
    /** @type {FinsClient}*/ const self = this;
    if (self.queueCount() >= self.max_queue) {
        self.emit('full');
        return null;
    }
    const memoryAddress = self.finsAddresses.stringToAddress(address);
    const addressData = self.finsAddresses.addressToBytes(memoryAddress);
    if (!addressData) {
        _sendParamError("address is invalid", callback, {tag: tag});
        return null;
    }
    if (!data || !data.length) {
        _sendParamError("data is empty", callback, {tag: tag});
        return null;
    }
    const SID = self.header.incrementSID();
    const header = self.header.build();
    const regsToWrite = wordsToBytes((data.length || 1));
    const command = constants.Commands.MEMORY_AREA_WRITE;
    if(memoryAddress.isBitAddress) {
        dataBytesToWrite = boolsToBytes(data);
    } else {
        dataBytesToWrite = wordsToBytes(data);
    }
    const commandData = [addressData, regsToWrite, dataBytesToWrite];
    const packet = buildPacket([header, command, commandData]);
    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        functionName: "write",
        address: memoryAddress,
        dataBytesToWrite: dataBytesToWrite,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, _req, tag);
    return SID;
};

/**
 * Memory Area Fill command. Fills 1 or more addresses with the same 16bit value.
 * @param {string} address - Memory area and the numerical start address e.g. `D100` or `CIO50`
 * @param {number} value - Value to write
 * @param {*} count - Number of registers to write
 * @param {commandCallback} [callback=null] - Optional callback method `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns the SID of the request (returns `null` if any of the command parameters are invalid).
 */
FinsClient.prototype.fill = function (address, value, count, callback, tag) {
    /** @type {FinsClient}*/ const self = this;
    if (self.queueCount() >= self.max_queue) {
        self.emit('full');
        return null;
    }
    const memoryAddress = self.finsAddresses.stringToAddress(address);
    const addressData = self.finsAddresses.addressToBytes(memoryAddress);
    if (!addressData) {
        _sendParamError("address is invalid", callback, {tag: tag});
        return null;
    }
    if (typeof value != "number") {
        _sendParamError("value is invalid", callback, {tag: tag});
        return null;
    }
    const SID = self.header.incrementSID();
    const header = self.header.build();
    const command = constants.Commands.MEMORY_AREA_FILL;
    const dataBytesToWrite  = wordsToBytes(value);
    const commandData = [addressData, wordsToBytes(count), dataBytesToWrite];
    const packet = buildPacket([header, command, commandData]);
    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        functionName: "fill",
        address: memoryAddress,
        count: count,
        dataBytesToWrite: dataBytesToWrite,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, _req, tag);
    return SID;
};

/**
 * Change PLC to MONITOR mode
 * @param {commandCallback} [callback=null] - Optional callback method `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns the SID of the request (returns `null` if any of the command parameters are invalid).
 */
FinsClient.prototype.run = function (callback, tag) {
    /** @type {FinsClient}*/ const self = this;
    if (self.queueCount() >= self.max_queue) {
        self.emit('full');
        return null;
    }
    const SID = self.header.incrementSID();
    const header = self.header.build();
    const command = constants.Commands.RUN;
    const packet = buildPacket([header, command]);
    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        functionName: "run",
        callback: callback
    };
    _transmitCommand(self, SID, buffer, _req, tag);
    return SID;
};

/**
 * Change PLC to PROGRAM mode
 * @param {commandCallback} [callback=null] - Optional callback method `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns the SID of the request (returns `null` if any of the command parameters are invalid).
 */

FinsClient.prototype.stop = function (callback, tag) {
    /** @type {FinsClient}*/ const self = this;
    if (self.queueCount() >= self.max_queue) {
        self.emit('full');
        return null;
    }
    const SID = self.header.incrementSID();
    const header = self.header.build();
    const command = constants.Commands.STOP;
    const packet = buildPacket([header, command]);
    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        functionName: "stop",
        callback: callback
    };
    _transmitCommand(self, SID, buffer, _req, tag);
    return SID;
};

/**
 * Get PLC status
 * @param {commandCallback} [callback=null] - Optional callback method `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns the SID of the request (returns `null` if any of the command parameters are invalid).
 */

FinsClient.prototype.status = function (callback, tag) {
    /** @type {FinsClient}*/ const self = this;
    if (self.queueCount() >= self.max_queue) {
        self.emit('full');
        return null;
    }
    const SID = self.header.incrementSID();
    const header = self.header.build();
    const command = constants.Commands.CONTROLLER_STATUS_READ;
    const packet = buildPacket([header, command]);
    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        functionName: "status",
        callback: callback
    };
    _transmitCommand(self, SID, buffer, _req, tag);
    return SID;
};


FinsClient.prototype.close = function () {
    /** @type {FinsClient}*/ const self = this;
    self.connected = false;
    self.sequenceManager.close();
    self.socket.close();
    self.socket.removeAllListeners();
    self.emit('close');//HACK: - cant get socket "close" event to fire
};

FinsClient.prototype.stringToFinsAddress = function (addressString) {
    return this.finsAddresses.stringToAddress(addressString);
};

FinsClient.prototype.FinsAddressToString = function (finsAddress, offsetWD, offsetBit) {
    return this.finsAddresses.addressToString(finsAddress, offsetWD, offsetBit);
};

FinsClient.prototype.queueCount = function () {
    var self = this;
    return self.sequenceManager.activeCount();
};




function _getResponseType (buf) {
    var response = [];
    response.push(buf[10]);
    response.push(buf[11]);
    return response;
};

/**
 * Transmit the command buffer to socket
 * @param {FinsClient} fcInstance - the FinsClient instance
 * @param {number} SID - Service ID for this transmission
 * @param {Buffer} buffer - the buffer to transmit
 * @param {Object} request - the request details object
 * @param {Any} tag - optional tag object to be sent in the request callback back after response is received
 */
function _transmitCommand(fcInstance, SID, buffer, request, tag ) {
    setImmediate(function (SID, buffer, _req, tag){
        fcInstance.sequenceManager.add(SID, _req, tag);//add the SID sequence manager for monitoring / timeout / stats etc
        fcInstance.socket.send(buffer, 0, buffer.length, fcInstance.port, fcInstance.host, function (err) {
            if (err) {
                fcInstance.sequenceManager.setError(SID, err);
            } else {
                fcInstance.sequenceManager.confirmSent(SID);
            }
        });
    }, SID, buffer, request, tag);
}

function _processEndCode (/** @type {number} */hiByte, /** @type {number} */loByte) {
    var  MRES = hiByte, SRES = loByte;
    var NetworkRelayError = ((MRES & 0x80) > 0);
    var NonFatalCPUUnitErr = ((SRES & 0x40) > 0);
    var FatalCPUUnitErr = ((SRES & 0x80) > 0);
    MRES = (MRES & 0x3f);
    SRES = (SRES & 0x2f);
    var endCode = ((MRES << 8) + SRES).toString(16) + ""; //.padStart(4,"0"); NodeJS8+
    while(endCode.length < 4) {
        endCode = "0" + endCode;
    }
    var endCodeDescription = constants.EndCodeDescriptions[endCode] + "";
    return {
        MRES: MRES,
        SRES: SRES,
        NetworkRelayError: NetworkRelayError,
        NonFatalCPUUnitErr: NonFatalCPUUnitErr,
        FatalCPUUnitErr: FatalCPUUnitErr,
        endCode: endCode,
        endCodeDescription: endCodeDescription
    }
}

function _processDefault (buf, rinfo) {
    var sid = buf[9];
    var command = (buf.slice(10, 12)).toString("hex");
    return { remoteHost: rinfo.address, sid: sid, command: command };
};

function _processStatusRead (buf, rinfo) {
    var sid = buf[9];
    var command = (buf.slice(10, 12)).toString("hex");
    var status = (buf[14] & 0x81); //Mask out battery[2] and CF[1] status or a direct lookup could fail. 
    var mode = buf[15];
    var fatalErrorData = {};
    var nonFatalErrorData = {};
    var fed = buf.readInt16BE(16);
    var nfed = buf.readInt16BE(18);
    var messageYN = buf.readInt16BE(20);
    var plcErrCode = buf.readInt16BE(22);
    var plcMessage = "";
    if(messageYN) plcMessage = buf.slice(24,-1).toString(); //PLC Message 

    //any fatal errors?
    if(fed){
        for (var i in constants.FatalErrorData) {
            if ((fed & constants.FatalErrorData[i]) != 0) {
                fatalErrorData[i] = true;
            }
        }
    }

    //any non fatal errors?
    if(nfed) {
        for (var j in constants.NonFatalErrorData) {
            if ((nfed & constants.NonFatalErrorData[j]) != 0) {
                nonFatalErrorData[j] = true;
            }
        }
    }
    
    var statusCodes = constants.Status;
    var runModes = constants.Modes;

    return {
        remoteHost: rinfo.address,
        sid: sid,
        command: command,
        commandDescription: "status",
        status: getKeyName(statusCodes, status),
        mode: getKeyName(runModes, mode),
        fatalErrors: (fed ? fatalErrorData : null),
        nonFatalErrors: (nfed ? nonFatalErrorData : null),
        plcErrCode: plcErrCode,
        plcMessage: plcMessage
    };
};

function _processMemoryAreaRead (buf, rinfo, sequenceManager) {
    var WDs;
    var wdValues = false;
    var bits;
    var bitValues = false;

    var sid = buf[9];
    var command = (buf.slice(10, 12)).toString("hex");
    var bufData = (buf.slice(14, buf.length));
    var plcAddress;
    if(sequenceManager) {
        let seq = sequenceManager.get(sid);
        plcAddress = seq && seq.request && seq.request.address;
        bitValues = plcAddress && plcAddress.isBitAddress == true;
        wdValues = plcAddress && plcAddress.isBitAddress == false;
    }
    if(bitValues){
        bits = [];
        bits.push(...bufData);
    } else if(wdValues) {
        WDs = [];
        for (var i = 0; i < bufData.length; i += 2) {
            WDs.push(bufData.readInt16BE(i));
        }
    }
    
    return {
        remoteHost: rinfo.address,
        sid: sid,
        command: command,
        commandDescription: "read",
        values: WDs ? WDs : bits,
        buffer: bufData,
    };
};

function _processReply (buf, rinfo, sequenceManager) {
    const commands = constants.Commands;
    const responseType = (_getResponseType(buf)).join(' ');   
    const processEndCode = _processEndCode(buf[12],buf[13]);
    let processResult;
    switch (responseType) {
        case commands.CONTROLLER_STATUS_READ.join(' '):
            processResult = _processStatusRead(buf, rinfo);
            break;
        case commands.MEMORY_AREA_READ.join(' '):
            processResult = _processMemoryAreaRead(buf, rinfo, sequenceManager);
            break;
        default:
            processResult = _processDefault(buf, rinfo);
            break;
    }
    processResult.endCode = processEndCode.endCode;
    processResult.endCodeDescription = processEndCode.endCodeDescription;
    processResult.MRES = processEndCode.MRES;
    processResult.SRES = processEndCode.SRES;
    processResult.NetworkRelayError = processEndCode.NetworkRelayError;
    processResult.NonFatalCPUUnitErr = processEndCode.NonFatalCPUUnitErr;
    processResult.FatalCPUUnitErr = processEndCode.FatalCPUUnitErr;
    return processResult;
};

function _sendParamError (message, callback, seq) {
    const addrErr = Error(message);
    if(callback) {
        callback(addrErr, seq)
    } else {
        self.emit('error', addrErr, seq);
    }
}
