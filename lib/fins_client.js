const dgram = require('dgram');
const net = require('net');
const inherits = require('util').inherits;
const EventEmitter = require('events').EventEmitter;
const constants = require('./constants');
const SequenceManager = require('./SequenceManager');
const FinsAddressUtil = require('./FinsAddressUtil');
const { normaliseBool, boolsToBytes, wordsToBytes, mergeData, getKeyName, isInt } = require('./data_utilities');

const MEMORY_AREA_READ = _getResponseCommandCode(...constants.Commands.MEMORY_AREA_READ);
const MEMORY_AREA_WRITE = _getResponseCommandCode(...constants.Commands.MEMORY_AREA_WRITE);
const MEMORY_AREA_FILL = _getResponseCommandCode(...constants.Commands.MEMORY_AREA_FILL);
const MEMORY_AREA_READ_MULTI = _getResponseCommandCode(...constants.Commands.MEMORY_AREA_READ_MULTI);
const MEMORY_AREA_TRANSFER = _getResponseCommandCode(...constants.Commands.MEMORY_AREA_TRANSFER);
const CONTROLLER_STATUS_READ = _getResponseCommandCode(...constants.Commands.CONTROLLER_STATUS_READ);

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
    self.initialised = false;
    self.port = port || defaultHost.port;
    self.host = host || defaultHost.host;
    self.options = options || {};
    self.options.MODE = self.options.MODE || "CS";
    self.timeout = (self.options.timeout) || defaultOptions.timeout || 2000;
    self.max_queue = (self.options.max_queue) || defaultOptions.max_queue || 100;
    self.protocol = (options && options.protocol) || defaultOptions.protocol;
    /** @type {FinsAddressUtil} */ self.finsAddresses = new FinsAddressUtil(self.options.MODE);

    self.sequenceManager = SequenceManager({ timeoutMS: this.timeout }, function (err, seq) {
        if (err) {
            self.emit("error", err, seq);
        }
    });

    //cleanup (if reconnecting, socket might be initialised)
    if (self.socket) {
        self.socket.removeAllListeners();

        delete self.socket;
    }
    if (self.tcp_socket) {
        try {
            self.tcp_socket.removeAllListeners();
            self.tcp_socket.destroy();
        } catch (error) {

        } finally {
            delete self.tcp_socket;
        }
    }

    self.remoteInfo = {
        address: self.host,
        family: 'IPV4',
        port: self.port,
        protocol: self.protocol
    }
    /** @type {dgram.Socket} */ self.socket = self.socket;
    /** @type {net.Socket} */ self.tcp_socket = self.tcp_socket;

    switch (self.protocol) {
        case 'udp':
          /** @type {dgram.Socket} */ self.socket = dgram.createSocket('udp4');
            self.socket.on('message', receive);
            self.socket.on('listening', listening);
            self.socket.on('close', close);
            self.socket.on('error', error);
            self.socket.connect(self.port, self.host)
            // self.socket.send("\n", 0, 1, self.port, self.host);//cause `listening` to be triggered
            break;
        case 'tcp':
          /** @type {net.Socket} */ self.tcp_socket = net.createConnection(self.port, self.host, tcp_init_listen_handler);
            self.tcp_socket.on('data', tcp_init_receive);
            self.tcp_socket.on('close', close);
            self.tcp_socket.on('error', error);
            break;
        default:
            throw new Error('invalid protocol option specified', options.protocol, 'protocol must be "udp" or "tcp"');
    }


    self.header = Object.assign({}, constants.DefaultFinsHeader);
    self.header.ICF = isInt(self.options.ICF, constants.DefaultFinsHeader.ICF);
    self.header.DNA = isInt(self.options.DNA, constants.DefaultFinsHeader.DNA);
    self.header.DA1 = isInt(self.options.DA1, constants.DefaultFinsHeader.DA1);
    self.header.DA2 = isInt(self.options.DA2, constants.DefaultFinsHeader.DA2);
    self.header.SNA = isInt(self.options.SNA, constants.DefaultFinsHeader.SNA);
    self.header.SA1 = isInt(self.options.SA1, constants.DefaultFinsHeader.SA1);
    self.header.SA2 = isInt(self.options.SA2, constants.DefaultFinsHeader.SA2);
    self.header.incrementSID = function () {
        this.SID = (Math.abs(this.SID) % 254) + 1;
        return this.SID;
    }
    self.header.build = function (DNA, DA1, DA2, SID) {
        const builtHeader = [
            this.ICF,
            this.RSV,
            this.GCT,
            DNA || this.DNA,
            DA1 || this.DA1,
            DA2 || this.DA2,
            this.SNA,
            this.SA1,
            this.SA2,
            SID || this.SID
        ];
        return builtHeader;
    };
    self.header.next = function (DNA, DA1, DA2) {
        const SID = this.incrementSID();
        const builtHeader = this.build(DNA, DA1, DA2, SID);
        return builtHeader;
    };

    self.connected = false;
    self.requests = {};

    function receive(buf, rinfo) {
        if (!rinfo && self.protocol == "tcp") {
            rinfo = self.remoteInfo;
        }
        try {
            if (rinfo.protocol === "tcp") {
                let offset = 0;
                while (offset < buf.length) {
                    const magic = buf.slice(0 + offset, 4 + offset).toString();
                    const len = buf.readUint32BE(4 + offset);
                    const cmd = buf.readUint32BE(8 + offset);
                    const err = buf.readUint32BE(12 + offset);
                    if (magic != "FINS") {
                        throw new Error("Expected FINS magic packet");
                    }
                    if (err) {
                        throw new Error(constants.TCPCommandErrorCodes[err] || "Error " + err);
                    }
                    const tcpBuf = buf.slice(offset+16, offset + len + 8);
                    process(tcpBuf);
                    offset += len + 8;
                }
            }
            process(buf);
        } catch (error) {
            self.emit('error', error);
        }

        function process(buffer) {
            const response = _processReply(buffer, rinfo, self.sequenceManager);
            if (response) {
                self.sequenceManager.done(response.sid); //1st, cancel the timeout
                var seq = self.sequenceManager.get(response.sid); //now get the sequence
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
                throw new Error("Unable to process the PLC reply");
            }
        }
    }

    function initialised() {
        self.initialised = true;
        self.emit('initialised', self.options);
    }

    function listening() {
        self.emit('open', self.remoteInfo);
        self.connected = true;
    }

    function tcp_init_listen_handler(err, data) {
        /* SEND FINS/TCP COMMAND*/

        /*
        * GENERATE FINS NODE NUMBER DATA SEND COMMAND (CLIENT TO SERVER)
        */
        let fins_tcp_header = Buffer.alloc(20);
        fins_tcp_header[0] = 70;// 'F'; /* Header */
        fins_tcp_header[1] = 73;// 'I';
        fins_tcp_header[2] = 78;// 'N';
        fins_tcp_header[3] = 83;// 'S';
        fins_tcp_header[4] = 0x00; /* Length */
        fins_tcp_header[5] = 0x00;
        fins_tcp_header[6] = 0x00;
        fins_tcp_header[7] = 0x0C;
        fins_tcp_header[8] = 0x00; /* Command */
        fins_tcp_header[9] = 0x00;
        fins_tcp_header[10] = 0x00;
        fins_tcp_header[11] = 0x00;
        fins_tcp_header[12] = 0x00; /* Error Code */
        fins_tcp_header[13] = 0x00;
        fins_tcp_header[14] = 0x00;
        fins_tcp_header[15] = 0x00;
        fins_tcp_header[16] = 0x00; /* Client Node Add */
        fins_tcp_header[17] = 0x00;
        fins_tcp_header[18] = 0x00;
        fins_tcp_header[19] = 0x00; /* AUTOMATICALLY GET FINS CLIENT FINS NODE NUMBER */
        self.tcp_socket.write(fins_tcp_header, () => { });
    }

    function tcp_init_receive(data) {
        // debugger
        if (data.length != 24) {
            error(new Error("Initial response is invalid - expected 24 bytes"));
            return;
        }

        const magic = data.slice(0, 4).toString();

        self.client_node_no = data[19]; //My node no
        self.server_node_no = data[23]; //PLC node no

        if (magic !== "FINS") {
            error(new Error("Initial response is invalid - expected for find 'FINS' at the beginning of the packet"));
            return;
        }
        self.tcp_socket.off("data", tcp_init_receive);
        self.tcp_socket.on("data", receive);
        listening();
    }

    function close() {
        self.emit('close');
        self.connected = false;
    }

    function error(err) {
        self.emit('error', err);
    }


    initialised();
};

FinsClient.prototype.reconnect = function () {
    /** @type {FinsClient}*/ const self = this;
    self.init(self.port, self.host, self.options);
};

/**
 * Optional callback for FINs commands
 * @callback CommandCallback
 * @param {*} err - Error (if any)
 * @param {object} msg - The msg object containing the `request`, `response`, `tag` and more.
 */

/**
 * @typedef {Object} CommandOptions
 * @property {number} [DNA=null] Destination Network Address
 * @property {number} [DA1=null] Destination Node
 * @property {number} [DA2=null] Destination Unit: Enter 0 for CPU, 10 to 1F for CPU BUS Unit (10+Unit), E1 for inner board
 * @property {CommandCallback} [callback=null] Callback to call upon PLC command response
 * @property {number} [timeoutMS=null] Optional timeout for this command
 */

/**
 * Memory Area Read Command.
 * FINS command code 01 01
 * @param {string} address - Memory area and the numerical start address e.g. `D100` or `CIO50.0`
 * @param {number} count - Number of registers to read
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeoutMS` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns the SID of the request (returns `null` if any of the command parameters are invalid).
 */
FinsClient.prototype.read = function (address, count, opts, tag) {
    /** @type {FinsClient}*/ const self = this;

    const { options, callback } = _normaliseCommandOptions(opts);
    if (self.queueCount() >= self.max_queue) {
        // console.warn("queue count exceeded")
        _sendFull(callback);
        return null;
    }

    const memoryAddress = self.stringToFinsAddress(address);
    const addressData = memoryAddress && memoryAddress.bytes;
    if (!addressData) {
        _sendError("invalid address", callback, { tag: tag });
        return null;
    }
    if (!count) {
        _sendError("count is empty", callback, { tag: tag });
        return null;
    }

    const header = self.header.next(options.DNA, options.DA1, options.DA2);
    const SID = self.header.SID;
    const command = constants.Commands.MEMORY_AREA_READ;
    const packet = mergeData(header, command, addressData, wordsToBytes(count));
    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        functionName: "read",
        options: options,
        address: memoryAddress,
        count: count,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, _req, tag);
    return SID;
};

/**
 * Memory Area Write Command.
 * FINS command code 01 02
 * @param {string} address - Memory area and the numerical start address e.g. `D100` or `CIO50.0`
 * @param {number} data - Data to write. This can be 1 value or an array values. For WD addresses, data value(s) should be 16 bit integer. For BIT addresses, data value(s) should be boolean or 1/0.
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeoutMS` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns the SID of the request (returns `null` if any of the command parameters are invalid).
 */
FinsClient.prototype.write = function (address, data, opts, tag) {
    /** @type {FinsClient}*/ const self = this;
    const { options, callback } = _normaliseCommandOptions(opts);
    if (self.queueCount() >= self.max_queue) {
        _sendFull(callback);
        return null;
    }
    const memoryAddress = self.stringToFinsAddress(address);
    const addressData = memoryAddress ? memoryAddress.bytes : null;
    if (!addressData || !addressData.length) {
        _sendError("invalid address", callback, { tag: tag });
        return null;
    }
    if (!data || !data.length) {
        _sendError("data is empty", callback, { tag: tag });
        return null;
    }
    const header = self.header.next(options.DNA, options.DA1, options.DA2);
    const SID = self.header.SID;
    const regsToWrite = wordsToBytes((data.length || 1));
    const command = constants.Commands.MEMORY_AREA_WRITE;
    if (memoryAddress.isBitAddress) {
        dataBytesToWrite = boolsToBytes(data);
    } else {
        dataBytesToWrite = wordsToBytes(data);
    }
    const packet = mergeData(header, command, addressData, regsToWrite, dataBytesToWrite);

    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        functionName: "write",
        options: options,
        address: memoryAddress,
        dataBytesToWrite: dataBytesToWrite,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, _req, tag);
    return SID;
};

/**
 * Memory Area Fill command. Fills 1 or more addresses with the same 16bit value.
 * FINS command code 01 03
 * @param {string} address - Memory area and the numerical start address e.g. `D100` or `CIO50`
 * @param {number} value - Value to write
 * @param {*} count - Number of registers to write
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeoutMS` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns the SID of the request (returns `null` if any of the command parameters are invalid).
 */
FinsClient.prototype.fill = function (address, value, count, opts, tag) {
    /** @type {FinsClient}*/ const self = this;
    const { options, callback } = _normaliseCommandOptions(opts);
    if (self.queueCount() >= self.max_queue) {
        _sendFull(callback);
        return null;
    }
    const memoryAddress = self.stringToFinsAddress(address);
    const addressData = memoryAddress && memoryAddress.bytes;
    if (!addressData) {
        _sendError("invalid address", callback, { tag: tag });
        return null;
    }
    if (typeof value != "number") {
        _sendError("value is invalid", callback, { tag: tag });
        return null;
    }
    const header = self.header.next(options.DNA, options.DA1, options.DA2);
    const SID = self.header.SID;
    const command = constants.Commands.MEMORY_AREA_FILL;
    const dataBytesToWrite = wordsToBytes(value);
    const packet = mergeData(header, command, addressData, wordsToBytes(count), dataBytesToWrite);

    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        functionName: "fill",
        options: options,
        address: memoryAddress,
        count: count,
        dataBytesToWrite: dataBytesToWrite,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, _req, tag);
    return SID;
};


/**
 * Multiple Memory Area Read Command.
 * FINS command code 01 04
 * @param  {string|string[]} addresses - Array or CSV of Memory addresses e.g. `"D10.15,CIO100,E0_100"` or `["CIO50.0","D30", "W0.0"]`
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeoutMS` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 */
FinsClient.prototype.readMultiple = function (addresses, opts, tag) {
    /** @type {FinsClient}*/ const self = this;
    const { options, callback } = _normaliseCommandOptions(opts);
    if (self.queueCount() >= self.max_queue) {
        _sendFull(callback);
        return null;
    }

    const header = self.header.next(options.DNA, options.DA1, options.DA2);
    const SID = self.header.SID;
    const command = constants.Commands.MEMORY_AREA_READ_MULTI;
    const commandData = [];
    let addressList = [];
    const memoryAddresses = [];
    if (typeof addresses == "string") {
        addressList = addresses.split(",");
    } else if (Array.isArray(addresses)) {
        addressList.push(...addresses);
    } else {
        _sendError("invalid address", callback, { tag: tag });
    }

    for (i = 0; i < addressList.length; i++) {
        let address = addressList[i];
        if (typeof address !== "string" || !address.trim().length) {
            _sendError("invalid address", callback, { tag: tag });
            return null;
        }
        address = address.trim();
        const memoryAddress = self.stringToFinsAddress(address);
        const addressData = memoryAddress && memoryAddress.bytes;
        if (!addressData) {
            _sendError("invalid address", callback, { tag: tag });
            return null;
        }
        commandData.push(addressData);
        memoryAddresses.push(memoryAddress);
    }
    const packet = mergeData(header, command, commandData);

    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        functionName: "read-multiple",
        options: options,
        address: memoryAddresses,
        count: addressList.length,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, _req, tag);
    return SID;
};

/**
 * MEMORY AREA TRANSFER.
 * Copies and transfers the contents of the specified number of consecutive memory area words to the specified memory area.
 * FINS command code 01 05
 * @param {string} srcAddress - Source Memory address e.g. `D100` or `CIO50`
 * @param {string} dstAddress - Destination Memory address e.g. `D200` or `CI100`
 * @param {number} count - Number of registers to copy
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeoutMS` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns SID
 */
FinsClient.prototype.transfer = function (srcAddress, dstAddress, count, opts, tag) {
    /** @type {FinsClient}*/ const self = this;
    const { options, callback } = _normaliseCommandOptions(opts);
    if (self.queueCount() >= self.max_queue) {
        _sendFull(callback);
        return null;
    }
    const header = self.header.next(options.DNA, options.DA1, options.DA2);
    const SID = self.header.SID;
    const srcMemoryAddress = self.stringToFinsAddress(srcAddress);
    const srcAddressData = srcMemoryAddress ? srcMemoryAddress.bytes : null;
    if (!srcAddressData || !srcAddressData.length) {
        _sendError("invalid source address", callback, { tag: tag });
        return null;
    }
    const dstMemoryAddress = self.stringToFinsAddress(dstAddress);
    const dstAddressData = dstMemoryAddress ? dstMemoryAddress.bytes : null;
    if (!dstAddressData || !dstAddressData.length) {
        _sendError("invalid destination address", callback, { tag: tag });
        return null;
    }

    var command = constants.Commands.MEMORY_AREA_TRANSFER;
    var commandData = [srcAddressData, dstAddressData, wordsToBytes(count)];
    var packet = mergeData(header, command, commandData);

    var buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        functionName: "transfer",
        options: options,
        srcAddress: srcMemoryAddress,
        dstAddress: dstMemoryAddress,
        count: count,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, _req, tag);
    return SID;
};

/**
 * Change PLC to MONITOR mode
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeoutMS` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns the SID of the request (returns `null` if any of the command parameters are invalid).
 */
FinsClient.prototype.run = function (opts, tag) {
    /** @type {FinsClient}*/ const self = this;
    const { options, callback } = _normaliseCommandOptions(opts);
    if (self.queueCount() >= self.max_queue) {
        _sendFull(callback);
        return null;
    }
    const header = self.header.next(options.DNA, options.DA1, options.DA2);
    const SID = self.header.SID;
    const command = constants.Commands.RUN;
    const packet = mergeData(header, command);
    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        functionName: "run",
        options: options,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, _req, tag);
    return SID;
};

/**
 * Change PLC to PROGRAM mode
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeoutMS` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns the SID of the request (returns `null` if any of the command parameters are invalid).
 */

FinsClient.prototype.stop = function (opts, tag) {
    /** @type {FinsClient}*/ const self = this;
    const { options, callback } = _normaliseCommandOptions(opts);
    if (self.queueCount() >= self.max_queue) {
        _sendFull(callback);
        return null;
    }
    const header = self.header.next(options.DNA, options.DA1, options.DA2);
    const SID = self.header.SID;
    const command = constants.Commands.STOP;
    const packet = mergeData(header, command);
    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        functionName: "stop",
        options: options,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, _req, tag);
    return SID;
};

/**
 * Get PLC status
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeoutMS` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns the SID of the request (returns `null` if any of the command parameters are invalid).
 */

FinsClient.prototype.status = function (opts, tag) {
    /** @type {FinsClient}*/ const self = this;
    const { options, callback } = _normaliseCommandOptions(opts);
    if (self.queueCount() >= self.max_queue) {
        _sendFull(callback);
        return null;
    }
    const header = self.header.next(options.DNA, options.DA1, options.DA2);
    const SID = self.header.SID;
    const command = constants.Commands.CONTROLLER_STATUS_READ;
    const packet = mergeData(header, command);
    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        functionName: "status",
        options: options,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, _req, tag);
    return SID;
};


FinsClient.prototype.close = function () {
    /** @type {FinsClient}*/ const self = this;
    self.connected = false;
    self.sequenceManager.close();
    try {
        if (self.socket) {
            self.socket.removeAllListeners();
            self.socket.close();
        }
    } catch (error) {

    } finally {
        delete self.socket;
    }

    try {
        if (self.tcp_socket) {
            self.tcp_socket.removeAllListeners();
            self.tcp_socket.destroy();
        }
    } catch (error) {
    } finally {
        delete self.tcp_socket;
    }
    self.connected = false;
    self.emit('close');//fire "close" manually since we already called removeAllListeners
};

FinsClient.prototype.stringToFinsAddress = function (addressString) {
    return this.finsAddresses.stringToAddress(addressString);
};

FinsClient.prototype.FinsAddressToString = function (finsAddress, offsetWD, offsetBit) {
    return this.finsAddresses.addressToString(finsAddress, offsetWD, offsetBit);
};

FinsClient.prototype.queueCount = function () {
    return this.sequenceManager.activeCount();
};

function _normaliseCommandOptions(/** @type {CommandCallback|CommandOptions}*/options) {
    /** @type {CommandCallback}*/ let callback;
    options = options || {};
    if (typeof options == "function") {
        callback = options
        options = {};
    }
    if (typeof options.callback == "function") {
        callback = options.callback
        delete options.callback;
    }
    return { options, callback };
}

function _getResponseCommandCode(byte10, byte11) {
    return [byte10, byte11].map(e => e.toString(16).padStart(2, "0")).join('');
};

/**
 * Transmit the command buffer to socket
 * @param {FinsClient} fcInstance - the FinsClient instance
 * @param {number} SID - Service ID for this transmission
 * @param {Buffer} buffer - the buffer to transmit
 * @param {Object} request - the request details object
 * @param {Any} tag - optional tag object to be sent in the request callback back after response is received
 */
function _transmitCommand(fcInstance, SID, buffer, request, tag) {
    setImmediate(function (SID, buffer, _req, tag) {
        fcInstance.sequenceManager.add(SID, _req, tag);//add the SID sequence manager for monitoring / timeout / stats etc
        const cb = function (err) {
            if (err) {
                fcInstance.sequenceManager.setError(SID, err);
            } else {
                fcInstance.sequenceManager.confirmSent(SID);
            }
        }
        if (fcInstance.protocol === "tcp") {
            let fins_tcp_header = Buffer.alloc(16);
            fins_tcp_header[0] = 70;// 'F'; /* Header */
            fins_tcp_header[1] = 73;// 'I';
            fins_tcp_header[2] = 78;// 'N';
            fins_tcp_header[3] = 83;// 'S';
            fins_tcp_header[4] = 0x00; /* Length */
            fins_tcp_header[5] = 0x00;
            fins_tcp_header[6] = 0x00;
            fins_tcp_header[7] = 8 + buffer.length; /*Length of data from Command up to end of FINS frame */
            fins_tcp_header[8] = 0x00; /* Command */
            fins_tcp_header[9] = 0x00;
            fins_tcp_header[10] = 0x00;
            fins_tcp_header[11] = 0x02;
            fins_tcp_header[12] = 0x00; /* Error Code */
            fins_tcp_header[13] = 0x00;
            fins_tcp_header[14] = 0x00;
            fins_tcp_header[15] = 0x00;
            buffer[4] = fcInstance.server_node_no//DA1 dest PLC node no
            buffer[7] = fcInstance.client_node_no//SA1 src node no

            const packet = Buffer.concat([fins_tcp_header, buffer]);
            fcInstance.tcp_socket.write(packet, cb);
        } else {
            fcInstance.socket.send(buffer, cb);
            // fcInstance.socket.send(buffer, 0, buffer.length, fcInstance.port, fcInstance.host, cb);
        }
    }, SID, buffer, request, tag);
}

function _processEndCode(/** @type {number} */hiByte, /** @type {number} */loByte) {
    var MRES = hiByte, SRES = loByte;
    var NetworkRelayError = ((MRES & 0x80) > 0);
    var NonFatalCPUUnitErr = ((SRES & 0x40) > 0);
    var FatalCPUUnitErr = ((SRES & 0x80) > 0);
    MRES = (MRES & 0x3f);
    SRES = (SRES & 0x2f);
    var endCode = ((MRES << 8) + SRES).toString(16) + ""; //.padStart(4,"0"); NodeJS8+
    while (endCode.length < 4) {
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

function _processDefault(buf, rinfo) {
    var sid = buf[9];
    var command = (buf.slice(10, 12)).toString("hex");
    return { remoteHost: rinfo.address, sid: sid, command: command };
};

function _processStatusRead(buf, rinfo) {
    var sid = buf[9];
    var command = _getResponseCommandCode(buf[10], buf[11]);
    var status = (buf[14] & 0x81); //Mask out battery[2] and CF[1] status or a direct lookup could fail.
    var mode = buf[15];
    var fatalErrorData = {};
    var nonFatalErrorData = {};
    var fed = buf.readInt16BE(16);
    var nfed = buf.readInt16BE(18);
    var messageYN = buf.readInt16BE(20);
    var plcErrCode = buf.readInt16BE(22);
    var plcMessage = "";
    if (messageYN) plcMessage = buf.slice(24, -1).toString(); //PLC Message

    //any fatal errors?
    if (fed) {
        for (var i in constants.FatalErrorData) {
            if ((fed & constants.FatalErrorData[i]) != 0) {
                fatalErrorData[i] = true;
            }
        }
    }

    //any non fatal errors?
    if (nfed) {
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

function _processMemoryAreaRead(buf, rinfo, sequenceManager) {
    var WDs;
    var wdValues = false;
    var bits;
    var bitValues = false;

    var sid = buf[9];
    var command = _getResponseCommandCode(buf[10], buf[11]);
    var bufData = (buf.slice(14, buf.length));
    var plcAddress;
    if (sequenceManager) {
        let seq = sequenceManager.get(sid);
        plcAddress = seq && seq.request && seq.request.address;
        bitValues = plcAddress && plcAddress.isBitAddress == true;
        wdValues = plcAddress && plcAddress.isBitAddress == false;
    }
    if (bitValues) {
        bits = [];
        bits.push(...bufData);
    } else if (wdValues) {
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

function _processMultipleMemoryAreaRead(buf, rinfo, sequenceManager) {
    const fnName = "read-multiple";
    var data = [];
    var sid = buf[9];
    var command = _getResponseCommandCode(buf[10], buf[11]);
    var bufData = (buf.slice(14));
    const seq = sequenceManager.get(sid);
    const memoryAddressList = [...seq.request.address];
    if (seq.request.functionName !== fnName) {
        throw new Error(`Unexpected function type response. Expected '${seq.request.functionName}' received '${fnName}'`)
    }

    for (var i = 0; i < bufData.length;) {
        const plcAddress = memoryAddressList.shift();
        const memAreaCode = bufData[i++];
        if (!plcAddress || plcAddress.memoryAreaCode !== memAreaCode) {
            throw new Error("unexpected memory address in response");
        }
        if (plcAddress.isBitAddress) {
            data.push(bufData[i]);
            i++; // move to the next memory area
        }
        else {
            data.push(bufData.readInt16BE(i));
            i = i + 2; // move to the next memory area
        }
    }
    return {
        remoteHost: rinfo.address,
        sid: sid,
        command: command,
        commandDescription: fnName,
        values: data,
        buffer: bufData,
    };
};


function _processReply(buf, rinfo, sequenceManager) {
    var responseCommandCode = _getResponseCommandCode(buf[10], buf[11]);
    const processEndCode = _processEndCode(buf[12], buf[13]);
    let processResult;
    switch (responseCommandCode) {
        case CONTROLLER_STATUS_READ:
            processResult = _processStatusRead(buf, rinfo);
            break;
        case MEMORY_AREA_READ:
            processResult = _processMemoryAreaRead(buf, rinfo, sequenceManager);
            break;
        case MEMORY_AREA_READ_MULTI:
            processResult = _processMultipleMemoryAreaRead(buf, rinfo, sequenceManager);
            break;
        default: //MEMORY_AREA_WRITE MEMORY_AREA_FILL MEMORY_AREA_TRANSFER
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

function _sendError(message, callback, seq) {
    const addrErr = Error(message);
    if (callback) {
        callback(addrErr, seq);
    } else {
        self.emit('error', addrErr, seq);
    }
}

function _sendFull(callback) {
    if (callback) {
        callback("full", null);
    }
    self.emit("full");
}
