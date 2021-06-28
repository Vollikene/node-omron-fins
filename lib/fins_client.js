const dgram = require('dgram');
const net = require('net');
const inherits = require('util').inherits;
const EventEmitter = require('events').EventEmitter;
const constants = require('./constants');
const SequenceManager = require('./SequenceManager');
const FinsAddressUtil = require('./FinsAddressUtil');
const { boolsToBytes, wordsToBytes, mergeData, getKeyName, isInt } = require('./data_utilities');

const MEMORY_AREA_READ = _getResponseCommandCode(...constants.CommandCodes.MEMORY_AREA_READ);
// const MEMORY_AREA_WRITE = _getResponseCommandCode(...constants.CommandCodes.MEMORY_AREA_WRITE);
// const MEMORY_AREA_FILL = _getResponseCommandCode(...constants.CommandCodes.MEMORY_AREA_FILL);
const MEMORY_AREA_READ_MULTI = _getResponseCommandCode(...constants.CommandCodes.MEMORY_AREA_READ_MULTI);
// const MEMORY_AREA_TRANSFER = _getResponseCommandCode(...constants.CommandCodes.MEMORY_AREA_TRANSFER);
const CPU_UNIT_DATA_READ = _getResponseCommandCode(...constants.CommandCodes.CPU_UNIT_DATA_READ);
const CPU_UNIT_STATUS_READ = _getResponseCommandCode(...constants.CommandCodes.CPU_UNIT_STATUS_READ);

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
            //do nothing
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
    // eslint-disable-next-line no-self-assign
    /** @type {dgram.Socket} */ self.socket = self.socket;
    // eslint-disable-next-line no-self-assign
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
                    //const cmd = buf.readUint32BE(8 + offset);
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
            } else {
                process(buf);
            }
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

    // eslint-disable-next-line no-unused-vars
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
 * FINS command code 0101
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
        _sendFull(self, callback);
        return null;
    }

    const memoryAddress = self.stringToFinsAddress(address);
    const addressData = memoryAddress && memoryAddress.bytes;
    if (!addressData) {
        _sendError(self, "invalid address", callback, { tag: tag });
        return null;
    }
    if (!count) {
        _sendError(self, "count is empty", callback, { tag: tag });
        return null;
    }

    const header = self.header.next(options.DNA, options.DA1, options.DA2);
    const SID = self.header.SID;
    const command = constants.Commands["0101"];
    const packet = mergeData(header, command.command, addressData, wordsToBytes(count));
    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        command: command,
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
 * FINS command code 0102
 * @param {string} address - Memory area and the numerical start address e.g. `D100` or `CIO50.0`
 * @param {number|number[]} data - Data to write. This can be 1 value or an array values. For WD addresses, data value(s) should be 16 bit integer. For BIT addresses, data value(s) should be boolean or 1/0.
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
        _sendError(self, "invalid address", callback, { tag: tag });
        return null;
    }
    if(!Array.isArray(data)) {
        data = [data];
    }
    if (!data || !data.length) {
        _sendError(self, "data is empty", callback, { tag: tag });
        return null;
    }
    const header = self.header.next(options.DNA, options.DA1, options.DA2);
    const SID = self.header.SID;
    const regsToWrite = wordsToBytes((data.length || 1));
    const command = constants.Commands["0102"];
    let dataBytesToWrite;
    if (memoryAddress.isBitAddress) {
        dataBytesToWrite = boolsToBytes(data);
    } else {
        dataBytesToWrite = wordsToBytes(data);
    }
    const packet = mergeData(header, command.command, addressData, regsToWrite, dataBytesToWrite);

    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        command: command,
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
 * FINS command code 0103
 * @param {string} address - Memory area and the numerical start address e.g. `D100` or `CIO50`
 * @param {number} value - Value to write
 * @param {number} count - Number of registers to write
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeoutMS` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns the SID of the request (returns `null` if any of the command parameters are invalid).
 */
FinsClient.prototype.fill = function (address, value, count, opts, tag) {
    /** @type {FinsClient}*/ const self = this;
    const { options, callback } = _normaliseCommandOptions(opts);
    if (self.queueCount() >= self.max_queue) {
        _sendFull(self, callback);
        return null;
    }
    const memoryAddress = self.stringToFinsAddress(address);
    const addressData = memoryAddress && memoryAddress.bytes;
    if (!addressData) {
        _sendError(self, "invalid address", callback, { tag: tag });
        return null;
    }
    if (typeof value != "number") {
        _sendError(self, "value is invalid", callback, { tag: tag });
        return null;
    }
    const header = self.header.next(options.DNA, options.DA1, options.DA2);
    const SID = self.header.SID;
    const command = constants.Commands["0103"];
    const dataBytesToWrite = wordsToBytes(value);
    const packet = mergeData(header, command.command, addressData, wordsToBytes(count), dataBytesToWrite);

    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        command: command,
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
 * FINS command code 0104
 * @param  {string|string[]} addresses - Array or CSV of Memory addresses e.g. `"D10.15,CIO100,E0_100"` or `["CIO50.0","D30", "W0.0"]`
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeoutMS` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 */
FinsClient.prototype.readMultiple = function (addresses, opts, tag) {
    /** @type {FinsClient}*/ const self = this;
    const { options, callback } = _normaliseCommandOptions(opts);
    if (self.queueCount() >= self.max_queue) {
        _sendFull(self, callback);
        return null;
    }

    const header = self.header.next(options.DNA, options.DA1, options.DA2);
    const SID = self.header.SID;
    const command = constants.Commands["0104"];
    const commandData = [];
    let addressList = [];
    const memoryAddresses = [];
    if (typeof addresses == "string") {
        addressList = addresses.split(",");
    } else if (Array.isArray(addresses)) {
        addressList.push(...addresses);
    } else {
        _sendError(self, "invalid address", callback, { tag: tag });
    }

    for (let i = 0; i < addressList.length; i++) {
        let address = addressList[i];
        if (typeof address !== "string" || !address.trim().length) {
            _sendError(self, "invalid address", callback, { tag: tag });
            return null;
        }
        address = address.trim();
        const memoryAddress = self.stringToFinsAddress(address);
        const addressData = memoryAddress && memoryAddress.bytes;
        if (!addressData) {
            _sendError(self, "invalid address", callback, { tag: tag });
            return null;
        }
        commandData.push(addressData);
        memoryAddresses.push(memoryAddress);
    }
    const packet = mergeData(header, command.command, commandData);

    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        command: command,
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
 * FINS command code 0105
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
        _sendFull(self, callback);
        return null;
    }
    const header = self.header.next(options.DNA, options.DA1, options.DA2);
    const SID = self.header.SID;
    const srcMemoryAddress = self.stringToFinsAddress(srcAddress);
    const srcAddressData = srcMemoryAddress ? srcMemoryAddress.bytes : null;
    if (!srcAddressData || !srcAddressData.length) {
        _sendError(self, "invalid source address", callback, { tag: tag });
        return null;
    }
    const dstMemoryAddress = self.stringToFinsAddress(dstAddress);
    const dstAddressData = dstMemoryAddress ? dstMemoryAddress.bytes : null;
    if (!dstAddressData || !dstAddressData.length) {
        _sendError(self, "invalid destination address", callback, { tag: tag });
        return null;
    }

    const command = constants.Commands["0105"];
    const commandData = [srcAddressData, dstAddressData, wordsToBytes(count)];
    const packet = mergeData(header, command.command, commandData);

    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        command: command,
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
 * FINS command code 0401
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeoutMS` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns the SID of the request (returns `null` if any of the command parameters are invalid).
 */
FinsClient.prototype.run = function (opts, tag) {
    /** @type {FinsClient}*/ const self = this;
    const { options, callback } = _normaliseCommandOptions(opts);
    if (self.queueCount() >= self.max_queue) {
        _sendFull(self, callback);
        return null;
    }
    const header = self.header.next(options.DNA, options.DA1, options.DA2);
    const SID = self.header.SID;
    const command = constants.Commands["0401"];
    const packet = mergeData(header, command.command);
    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        command: command,
        options: options,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, _req, tag);
    return SID;
};

/**
 * Change PLC to PROGRAM mode
 * FINS command code 0402
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeoutMS` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns the SID of the request (returns `null` if any of the command parameters are invalid).
 */

FinsClient.prototype.stop = function (opts, tag) {
    /** @type {FinsClient}*/ const self = this;
    const { options, callback } = _normaliseCommandOptions(opts);
    if (self.queueCount() >= self.max_queue) {
        _sendFull(self, callback);
        return null;
    }
    const header = self.header.next(options.DNA, options.DA1, options.DA2);
    const SID = self.header.SID;
    const command = constants.Commands["0402"];
    const packet = mergeData(header, command.command);
    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        command: command,
        options: options,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, _req, tag);
    return SID;
};

/**
 * CPU UNIT DATA READ. Reads CPU Unit data
 * FINS command code 0501
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeoutMS` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns the SID of the request (returns `null` if any of the command parameters are invalid).
 */

FinsClient.prototype.cpuUnitDataRead = function (opts, tag) {
    /** @type {FinsClient}*/ const self = this;
    const { options, callback } = _normaliseCommandOptions(opts);
    if (self.queueCount() >= self.max_queue) {
        _sendFull(self, callback);
        return null;
    }
    const header = self.header.next(options.DNA, options.DA1, options.DA2);
    const SID = self.header.SID;
    const command = constants.Commands["0501"];
    const packet = mergeData(header, command.command);
    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        command: command,
        options: options,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, _req, tag);
    return SID;
};

/**
 * Get PLC status
 * FINS command code 0601
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeoutMS` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns the SID of the request (returns `null` if any of the command parameters are invalid).
 */

FinsClient.prototype.status = function (opts, tag) {
    /** @type {FinsClient}*/ const self = this;
    const { options, callback } = _normaliseCommandOptions(opts);
    if (self.queueCount() >= self.max_queue) {
        _sendFull(self, callback);
        return null;
    }
    const header = self.header.next(options.DNA, options.DA1, options.DA2);
    const SID = self.header.SID;
    const command = constants.Commands["0601"];
    const packet = mergeData(header, command.command);
    const buffer = Buffer.from(packet);
    const _req = {
        sid: SID,
        command: command,
        options: options,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, _req, tag);
    return SID;
};




/**
 * Generic command 
 * @param {string} commandCode 4 digit command code. e.g. 0101 MEMORY AREA READ
 * @param {Any[]} params associated command parameters
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeoutMS` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns 
 */
 FinsClient.prototype.command = function (commandCode, params, opts, tag) {
    /** @type {FinsClient}*/ const self = this;
    const { options, callback } = _normaliseCommandOptions(opts);
    if (self.queueCount() >= self.max_queue) {
        _sendFull(self, callback);
        return null;
    }
    const cmd =  constants.Commands[commandCode];
    if(!cmd) {
        _sendError(`commandCode '${commandCode}' not recognised`, callback, { tag: tag });
        return null;
    }

    //basic parameter check
    if(cmd.params && cmd.params.length) {
        for (let index = 0; index < cmd.params.length; index++) {
            const expectedParam = cmd.params[index];
            const providedParam = params[index];
            if(!providedParam && expectedParam.required) {
                _sendError(`Parameter ${index+1} Missing. Expected '${expectedParam.name}'`, callback, { tag: tag });
            }
            if(expectedParam.type == null || expectedParam.type == "*" || expectedParam.type == "Any") {
                //param type ok
            } else if(typeof providedParam !== expectedParam.type) {
                _sendError(`Parameter ${index+1} '${expectedParam.name}' incorrect type. Expected type of '${expectedParam.type}'`, callback, { tag: tag });
            }
        }
    }


    if(cmd.name == "read") {
        return self.read(params[0], params[1], options, tag);
    } else if(cmd.name == "write") {
        return self.write(params[0], params[1], options, tag);
    } else if(cmd.name == "read-multiple") {
        return self.readMultiple(params[0], options, tag);
    } else if(cmd.name == "fill") {
        return self.fill(params[0], params[1], params[2], options, tag);
    } else if(cmd.name == "transfer") {
        return self.transfer(params[0], params[1], params[2], options, tag);
    } else if(cmd.name == "status") {
        return self.status(options, tag);
    } else if(cmd.name == "run") {
        return self.run(options, tag);
    } else if(cmd.name == "stop") {
        return self.stop(options, tag);
    } else if(cmd.name == "cpu-unit-data-read") {
        return self.cpuUnitDataRead(options, tag);
    } else {
        _sendError(`command not recognised`, callback, { tag: tag });
        return null;
    }
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
        //do nothing
    } finally {
        delete self.socket;
    }

    try {
        if (self.tcp_socket) {
            self.tcp_socket.removeAllListeners();
            self.tcp_socket.destroy();
        }
    } catch (error) {
        //do nothing
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
}

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
    let MRES = hiByte, SRES = loByte;
    const NetworkRelayError = ((MRES & 0x80) > 0);
    const NonFatalCPUUnitErr = ((SRES & 0x40) > 0);
    const FatalCPUUnitErr = ((SRES & 0x80) > 0);
    MRES = (MRES & 0x3f);
    SRES = (SRES & 0x2f);
    let endCode = ((MRES << 8) + SRES).toString(16) + ""; //.padStart(4,"0"); NodeJS8+
    while (endCode.length < 4) {
        endCode = "0" + endCode;
    }
    const endCodeDescription = constants.EndCodeDescriptions[endCode] + "";
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

function _initialProcessing(buf, sequenceManager, fnName, expectedCmdCode ) {
    const sid = buf[9];
    const responseCommandCode = _getResponseCommandCode(buf[10], buf[11]);
    const seq = sequenceManager.get(sid);
    if(!seq || sid > sequenceManager.maxSID || sid < sequenceManager.minSID) {
        throw new Error(`Unexpected SID '${sid}' received`)
    }
    expectedCmdCode = expectedCmdCode || constants.Commands[responseCommandCode].commandCode
    if (responseCommandCode !== expectedCmdCode) {
        throw new Error(`Unexpected command code response. Expected '${expectedCmdCode}' received '${responseCommandCode}'`)
    }    
    fnName = fnName || constants.Commands[responseCommandCode].name;
    if (seq.request.command.name !== fnName) {
        throw new Error(`Unexpected function type response. Expected '${fnName}' received '${seq.request.command.name}'`)
    }
    return {
        sid,
        seq,
        command: seq.request.command
    }
}

function _processDefault(buf, rinfo, sequenceManager) {
    const cmdCode = (buf.slice(10, 12)).toString("hex");
    const fnName = constants.Commands[cmdCode].name;
    const {sid, command} = _initialProcessing(buf, sequenceManager, fnName, cmdCode);
    return { remoteHost: rinfo.address, sid: sid, command: command };
}


function _processCpuUnitDataRead(buf, rinfo, sequenceManager) {
    /*
    * see https://www.myomron.com/downloads/1.Manuals/PLCs/CPUs/W342-E1-14%20CS_CJ_CP+HostLink%20FINS%20ReferenceManual.pdf
    * data starts at byte 14 in buffer
    * 20bytes = CPU Unit model, 
    * 20bytes = CPU Unit internal system version
    * 40bytes For system use
    * 12bytes Area data
    * 64bytes CPU Bus Unit configuration
    * 1byte CPU Unit information
    * 1byte Remote I/O data 
    */
    const fnName = "cpu-unit-data-read";
    const cmdCode = "0501";
    const {sid, command} = _initialProcessing(buf, sequenceManager, fnName, cmdCode);
    const data = buf.slice(14); 
    const CPUUnitModel = data.slice(0,20);
    const CPUUnitInternalSystemVersion = data.slice(20,40);
    const SystemUse = data.slice(40,80);
    const DIPSwitches = SystemUse.readUInt8();
    const switches = {
        SW1: (DIPSwitches & 0b00000001) == 0b00000001,
        SW2: (DIPSwitches & 0b00000010) == 0b00000010,
        SW3: (DIPSwitches & 0b00000100) == 0b00000100,
        SW4: (DIPSwitches & 0b00001000) == 0b00001000,
        SW5: (DIPSwitches & 0b00010000) == 0b00010000,
        SW6: (DIPSwitches & 0b00100000) == 0b00100000,
        SW7: (DIPSwitches & 0b01000000) == 0b01000000,
        SW8: (DIPSwitches & 0b10000000) == 0b10000000,
    }
    const AreaData = data.slice(80,92);
    const MaxProgramSizeKb = AreaData.readUInt16BE(0); //Maximum size of usable program area
    const IOMSizeKb = AreaData.readUInt8(2);//The size of the area (CIO, WR, HR, AR, timer/    counter completion flags, TN) in which bit commands     can be used (always 23)
    const NoOfDMWords = AreaData.readUInt16BE(3);//Total words in the DM area (always 32,768)
    const TimerCounterSizeKb = AreaData.readUInt8(5); //Maximum number of timers/counters available (always 8)
    const EMBankCount_NonFile = AreaData.readUInt8(6); // Among the banks in the EM area, the number of banks (0 to D) without file memory
    const MemoryCardType = AreaData.readUInt8(8);
    const MemoryCardSize = AreaData.readUInt16BE(10);

    const CPUBusUnitConfiguration = data.slice(92,156);
    const CPUUnitInformation = data.slice(156,157);
    const RemoteIOData = data.slice(157,158);
    
    const CPUBusUnitConfigurationParser = function(unit, buf) {
        let present =  (buf[0] & 0x80) == 0x80;
        buf[0] = (buf[0]  & 0x7F);
        return {
            unit: unit,
            modelID: buf.toString(),
            present
        }
    }
    const CPUBusUnitConfigurationItems = [];
    for (let index = 0; index < 16; index++) {
        const idx = index*2;
        const entry = CPUBusUnitConfiguration.slice(idx,idx+2);
        CPUBusUnitConfigurationItems.push(CPUBusUnitConfigurationParser(index, entry));
    }

    return {
        remoteHost: rinfo.address,
        sid: sid,
        command: command,
        CPUUnitModel: CPUUnitModel.toString(),
        CPUUnitInternalSystemVersion: CPUUnitInternalSystemVersion.toString(),
        SystemUse: {
            DIPSwitches: switches,
            LargestEMBankNumber: SystemUse.readUInt8(1)
        },
        AreaData: {
            MaxProgramSizeKb,
            IOMSizeKb,
            NoOfDMWords,
            TimerCounterSizeKb,
            EMBankCount_NonFile,
            MemoryCardType,
            MemoryCardSize
        },
        CPUBusUnitConfiguration: CPUBusUnitConfigurationItems,
        SYSMACBUSMastersCount: (RemoteIOData[0] & 0x03),
        RackCount: (CPUUnitInformation[0] & 0x0f) ,
    };
}

function _processStatusRead(buf, rinfo, sequenceManager) {
    const fnName = "status";
    const cmdCode = "0601"
    const {sid, command} = _initialProcessing(buf, sequenceManager, fnName, cmdCode);
    const status = (buf[14] & 0x81); //Mask out battery[2] and CF[1] status or a direct lookup could fail.
    const mode = buf[15];
    const fatalErrorData = {};
    const nonFatalErrorData = {};
    const fed = buf.readInt16BE(16);
    const nfed = buf.readInt16BE(18);
    const messageYN = buf.readInt16BE(20);
    const plcErrCode = buf.readInt16BE(22);
    let plcMessage = "";
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

    const statusCodes = constants.Status;
    const runModes = constants.Modes;

    return {
        remoteHost: rinfo.address,
        sid: sid,
        command: command,
        status: getKeyName(statusCodes, status),
        mode: getKeyName(runModes, mode),
        fatalErrors: (fed ? fatalErrorData : null),
        nonFatalErrors: (nfed ? nonFatalErrorData : null),
        plcErrCode: plcErrCode,
        plcMessage: plcMessage
    };
}


function _processMemoryAreaRead(buf, rinfo, sequenceManager) {
    const fnName = "read";
    const cmdCode = "0101"
    const {sid, seq, command} = _initialProcessing(buf, sequenceManager, fnName, cmdCode);
    let WDs;
    let wdValues = false;
    let bits;
    let bitValues = false;
    const bufData = (buf.slice(14, buf.length));
    let plcAddress;
    plcAddress = seq.request && seq.request.address;
    bitValues = plcAddress && plcAddress.isBitAddress == true;
    wdValues = plcAddress && plcAddress.isBitAddress == false;

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
}

function _processMultipleMemoryAreaRead(buf, rinfo, sequenceManager) {
    const fnName = "read-multiple";
    const cmdCode = "0104"
    const {sid, seq, command} = _initialProcessing(buf, sequenceManager, fnName, cmdCode);
    const data = [];
    const bufData = (buf.slice(14));
    const memoryAddressList = [...seq.request.address];
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
        values: data,
        buffer: bufData,
    };
}


function _processReply(buf, rinfo, sequenceManager) {
    const responseCommandCode = _getResponseCommandCode(buf[10], buf[11]);
    const processEndCode = _processEndCode(buf[12], buf[13]);

    let processResult;
    switch (responseCommandCode) {
        case CPU_UNIT_STATUS_READ:
            processResult = _processStatusRead(buf, rinfo, sequenceManager);
            break;
        case CPU_UNIT_DATA_READ:
            processResult = _processCpuUnitDataRead(buf, rinfo, sequenceManager);
            break;
        case MEMORY_AREA_READ:
            processResult = _processMemoryAreaRead(buf, rinfo, sequenceManager);
            break;
        case MEMORY_AREA_READ_MULTI:
            processResult = _processMultipleMemoryAreaRead(buf, rinfo, sequenceManager);
            break;
        default: //MEMORY_AREA_WRITE MEMORY_AREA_FILL MEMORY_AREA_TRANSFER
            processResult = _processDefault(buf, rinfo, sequenceManager);
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
}

function _sendError(self, message, callback, seq) {
    const addrErr = Error(message);
    if (callback) {
        callback(addrErr, seq);
    } else {
        self.emit('error', addrErr, seq);
    }
}

function _sendFull(self, callback) {
    if (callback) {
        callback("full", null);
    }
    self.emit("full");
}
