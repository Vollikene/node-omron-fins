const dgram = require('dgram');
const net = require('net');
const inherits = require('util').inherits;
const EventEmitter = require('events').EventEmitter;
const constants = require('./FinsConstants');
const SequenceManager = require('./FinsSequenceManager');
const FinsHeader = require('./FinsHeader');
const FinsAddressUtil = require('./FinsAddressUtil');
const {dec2bcd, bcd2dec, boolsToBytes, wordsToBytes, dwordsToBytes, mergeData, getKeyName, isInt } = require('./FinsDataUtils');

const MEMORY_AREA_READ = _getResponseCommandCode(...constants.CommandCodes.MEMORY_AREA_READ);
const MEMORY_AREA_WRITE = _getResponseCommandCode(...constants.CommandCodes.MEMORY_AREA_WRITE);
const MEMORY_AREA_FILL = _getResponseCommandCode(...constants.CommandCodes.MEMORY_AREA_FILL);
const MEMORY_AREA_READ_MULTI = _getResponseCommandCode(...constants.CommandCodes.MEMORY_AREA_READ_MULTI);
const MEMORY_AREA_TRANSFER = _getResponseCommandCode(...constants.CommandCodes.MEMORY_AREA_TRANSFER);
const CPU_UNIT_DATA_READ = _getResponseCommandCode(...constants.CommandCodes.CPU_UNIT_DATA_READ);
const CPU_UNIT_STATUS_READ = _getResponseCommandCode(...constants.CommandCodes.CPU_UNIT_STATUS_READ);
const STOP = _getResponseCommandCode(...constants.CommandCodes.STOP);
const RUN = _getResponseCommandCode(...constants.CommandCodes.RUN);
const CLOCK_READ = _getResponseCommandCode(...constants.CommandCodes.CLOCK_READ);
const CLOCK_WRITE = _getResponseCommandCode(...constants.CommandCodes.CLOCK_WRITE);

//#region Common JSdoc hints

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
 * @property {number} [timeout=null] Optional timeout for this command
 */

//#endregion

module.exports = FinsClient;

/**
 * 
 * @param {number} port The UDP/TCP port to connect to
 * @param {string} host The IP or hostname to connect to
 * @param {object} options Additional options including `protocol` `MODE` `timeout` `DNA` `DA1` `DA2` `SNA` `SA1` `SA2`
 * @param {boolean} [connect=true] (optional, default=true) Connect to PLC when initialising
 * @returns 
 */
function FinsClient(port, host, options, connect) {
    if (!(this instanceof FinsClient)) return new FinsClient(port, host, options, connect);
    EventEmitter.call(this);
    this.init(port, host, options);
    //default is to connect
    if(connect === true || connect == null) {
        this.connect();
    }
}

inherits(FinsClient, EventEmitter);


//#region FinsClient prototypes

/**
 * Initialise the FinsClient - must be called before `FinsClient.connect()`.
 * NOTE: `init` is normally called when the FinsClient is created. This function is not normally called by user code.
 * @param {number} port The UDP/TCP port to connect to
 * @param {string} host The IP or hostname to connect to
 * @param {object} options Additional options including `MODE` `protocol` `timeout` `DNA` `DA1` `DA2` `SNA` `SA1` `SA2`
 */
FinsClient.prototype.init = function (port, host, options) {
    /** @type {FinsClient}*/ const self = this;
    const defaultHost = constants.DefaultHostValues;
    const defaultOptions = constants.DefaultOptions;
    self.initialised = false;
    self.connected = false;
    self.requests = {};
    self.port = port || defaultHost.port;
    self.host = host || defaultHost.host;
    self.options = options || {};
    self.options.MODE = self.options.MODE || "CS";
    self.timeout = isInt(options.timeout, defaultOptions.timeout) || 2000;
    self.max_queue = isInt(options.ICF, defaultOptions.max_queue) || 100;
    self.protocol = (options && options.protocol) || defaultOptions.protocol || "udp";
    /** @type {FinsAddressUtil} */ self.finsAddresses = new FinsAddressUtil(self.options.MODE);

    try {
        self.options.maxEventListeners = parseInt(self.options.maxEventListeners || 30);
        if(isNaN(self.options.maxEventListeners) || self.options.maxEventListeners <= 0) {
            self.options.maxEventListeners = 30;
        }
    } catch (error) {
        self.options.maxEventListeners = 30;
    }
    this.setMaxListeners(self.options.maxEventListeners);

    switch (self.protocol) {
    case 'udp':
    case 'tcp':
        break;
    default:
        throw new Error('invalid protocol option specified', self.protocol, 'protocol must be "udp" or "tcp"');
    }

    self.header = FinsHeader(self.options);
    self.sequenceManager = new SequenceManager({ timeout: this.timeout }, function (err, seq) {
        if (err) {
            self.emit("error", err, seq);
        }
    });

    self.disconnect();

    self.remoteInfo = {
        address: self.host,
        family: 'IPV4',
        port: self.port,
        protocol: self.protocol
    }

    self._socket_handler_receive = socket_receive.bind(self);
    self._socket_handler_initialised = socket_initialised.bind(self);
    self._socket_handler_listening = socket_listening.bind(self);
    self._socket_handler_tcp_init_listening = tcp_socket_init_listening.bind(self);
    self._socket_handler_tcp_init_receive = tcp_socket_init_receive.bind(self);
    self._socket_handler_close = socket_close.bind(self);
    self._socket_handler_error = socket_error.bind(self);
    self.processReply = _processReply.bind(self);
    socket_initialised.call(self);
};

/**
 * Open the connection to the PLC. 
 * NOTE: if `host`, `port` or `options` are provided, any currently open connection will be closed then re-opened using the new values provided. 
 * If you simply wish to connect with existing settings, call `connect()` without any parameters. If the connection is already open, the function will simply exit.
 * @param {number} port The UDP/TCP port to connect to
 * @param {string} host The IP or hostname to connect to
 * @param {object} options Additional options including `MODE` `protocol` `timeout` `DNA` `DA1` `DA2` `SNA` `SA1` `SA2`
 */
FinsClient.prototype.connect = function (host, port, options) {
    /** @type {FinsClient}*/ const self = this;
    if(!self.initialised) {
        throw new Error('Cannot connect (not initialised)');
    }
    if(self.connected) {
        return;
    }
    self.disconnect();//first ensure connection is cleaned up

    if(host != null || port != null || options != null) {
        const optionOverride = (existingOpts, newOpts, optionName ) => { 
            if(!optionName || !existingOpts || !newOpts) return;
            if( Object.prototype.hasOwnProperty.call(newOpts, optionName) ) {
                existingOpts[optionName] = newOpts[optionName];
            }
        };
        if(typeof options == "object") {
            optionOverride(self.options, options, "protocol");
            optionOverride(self.options, options, "MODE");
            optionOverride(self.options, options, "timeout");
            optionOverride(self.options, options, "max_queue");
            optionOverride(self.options, options, "SNA");
            optionOverride(self.options, options, "SA1");
            optionOverride(self.options, options, "SA2");
            optionOverride(self.options, options, "DNA");
            optionOverride(self.options, options, "DA1");
            optionOverride(self.options, options, "DA2");
            optionOverride(self.options, options, "maxEventListeners");
        }
        self.init(port || self.port, host || self.host, self.options);
        if(!self.initialised) {
            throw new Error('Cannot connect (not initialised)');
        }
    }

    // eslint-disable-next-line no-self-assign
    /** @type {dgram.Socket} */ self.socket = self.socket;
    // eslint-disable-next-line no-self-assign
    /** @type {net.Socket} */ self.tcp_socket = self.tcp_socket;
    switch (self.protocol) {
    case 'udp':
        /** @type {dgram.Socket} */ self.socket = dgram.createSocket('udp4');
        self.socket.on('message', self._socket_handler_receive);
        self.socket.on('listening', self._socket_handler_listening);
        self.socket.on('close', self._socket_handler_close);
        self.socket.on('error', self._socket_handler_error);
        self.socket.connect(self.port, self.host);
        break;
    case 'tcp':
        /** @type {net.Socket} */ self.tcp_socket = net.createConnection(self.port, self.host, self._socket_handler_tcp_init_listening);
        self.tcp_socket.on('data', self._socket_handler_tcp_init_receive);
        self.tcp_socket.on('close', self._socket_handler_close);
        self.tcp_socket.on('error', self._socket_handler_error);
        break;
    default:
        throw new Error('invalid protocol option specified', options.protocol, 'protocol must be "udp" or "tcp"');
    }
};

/**
 * Disconnect the socket from PLC
 */
FinsClient.prototype.disconnect = function () {
    /** @type {FinsClient}*/ const self = this;
    const doEmit = self.connected;
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
    doEmit && self.emit('close'); //fire "close" manually since we already called removeAllListeners

};



/**
 * Memory Area Read Command.
 * FINS command code 0101
 * @param {string} address - Memory area and the numerical start address e.g. `D100` or `CIO50.0`
 * @param {number} count - Number of registers to read
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeout` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns the SID of the request (returns `null` if any of the command parameters are invalid).
 */
FinsClient.prototype.read = function (address, count, opts, tag) {
    /** @type {FinsClient}*/ const self = this;
    const { options, callback } = _normaliseCommandOptions(opts);
    if (self.queueCount() >= self.max_queue) {
        _sendFull(self, callback);
        return null;
    }
    if(self.connected !== true) {
        _sendError(self, "not connected", callback, { tag: tag });
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
    
    const SID = self.header.incrementSID();
    const headerBytes = self.header.bytes(options);
    const command = constants.Commands["0101"];
    const packet = mergeData(headerBytes, command.command, addressData, wordsToBytes(count));
    const buffer = Buffer.from(packet);
    const request = {
        sid: SID,
        command: command,
        options: options,
        address: memoryAddress,
        count: count,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, request, tag);
    return SID;
};

/**
 * Memory Area Write Command.
 * FINS command code 0102
 * @param {string} address - Memory area and the numerical start address e.g. `D100` or `CIO50.0`
 * @param {number|number[]} data - Data to write. This can be 1 value or an array values. For WD addresses, data value(s) should be 16 bit integer. For BIT addresses, data value(s) should be boolean or 1/0.
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeout` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
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
    if(self.connected !== true) {
        _sendError(self, "not connected", callback, { tag: tag });
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
    const SID = self.header.incrementSID();
    const headerBytes = self.header.bytes(options);
    const regsToWrite = wordsToBytes((data.length || 1));
    const command = constants.Commands["0102"];
    let dataBytesToWrite;
    if (memoryAddress.isBitAddress) {
        dataBytesToWrite = boolsToBytes(data);
    } else if (memoryAddress.elementLength === 4) {
        dataBytesToWrite = dwordsToBytes(data);
    } else {
        dataBytesToWrite = wordsToBytes(data);
    }
    const packet = mergeData(headerBytes, command.command, addressData, regsToWrite, dataBytesToWrite);
    const buffer = Buffer.from(packet);
    const request = {
        sid: SID,
        command: command,
        options: options,
        address: memoryAddress,
        dataBytesToWrite: dataBytesToWrite,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, request, tag);
    return SID;
};

/**
 * Memory Area Fill command. Fills 1 or more addresses with the same 16bit value.
 * FINS command code 0103
 * @param {string} address - Memory area and the numerical start address e.g. `D100` or `CIO50`
 * @param {number} value - Value to write
 * @param {number} count - Number of registers to write
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeout` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
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
    if(self.connected !== true) {
        _sendError(self, "not connected", callback, { tag: tag });
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
    const SID = self.header.incrementSID();
    const headerBytes = self.header.bytes(options);
    const command = constants.Commands["0103"];
    const dataBytesToWrite = wordsToBytes(value);
    const packet = mergeData(headerBytes, command.command, addressData, wordsToBytes(count), dataBytesToWrite);

    const buffer = Buffer.from(packet);
    const request = {
        sid: SID,
        command: command,
        options: options,
        address: memoryAddress,
        count: count,
        dataBytesToWrite: dataBytesToWrite,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, request, tag);
    return SID;
};


/**
 * Multiple Memory Area Read Command.
 * FINS command code 0104
 * @param  {string|string[]} addresses - Array or CSV of Memory addresses e.g. `"D10.15,CIO100,E0_100"` or `["CIO50.0","D30", "W0.0"]`
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeout` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 */
FinsClient.prototype.readMultiple = function (addresses, opts, tag) {
    /** @type {FinsClient}*/ const self = this;
    const { options, callback } = _normaliseCommandOptions(opts);
    if (self.queueCount() >= self.max_queue) {
        _sendFull(self, callback);
        return null;
    }
    if(self.connected !== true) {
        _sendError(self, "not connected", callback, { tag: tag });
        return null;
    }
    const SID = self.header.incrementSID();
    const headerBytes = self.header.bytes(options);
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
    const packet = mergeData(headerBytes, command.command, commandData);
    const buffer = Buffer.from(packet);
    const request = {
        sid: SID,
        command: command,
        options: options,
        address: memoryAddresses,
        count: addressList.length,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, request, tag);
    return SID;
};

/**
 * MEMORY AREA TRANSFER.
 * Copies and transfers the contents of the specified number of consecutive memory area words to the specified memory area.
 * FINS command code 0105
 * @param {string} srcAddress - Source Memory address e.g. `D100` or `CIO50`
 * @param {string} dstAddress - Destination Memory address e.g. `D200` or `CI100`
 * @param {number} count - Number of registers to copy
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeout` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
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
    if(self.connected !== true) {
        _sendError(self, "not connected", callback, { tag: tag });
        return null;
    }
    const SID = self.header.incrementSID();
    const headerBytes = self.header.bytes(options);
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
    const packet = mergeData(headerBytes, command.command, commandData);

    const buffer = Buffer.from(packet);
    const request = {
        sid: SID,
        command: command,
        options: options,
        srcAddress: srcMemoryAddress,
        dstAddress: dstMemoryAddress,
        count: count,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, request, tag);
    return SID;
};

/**
 * Change PLC to MONITOR mode
 * FINS command code 0401
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeout` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
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
    if(self.connected !== true) {
        _sendError(self, "not connected", callback, { tag: tag });
        return null;
    }
    const SID = self.header.incrementSID();
    const headerBytes = self.header.bytes(options);
    const command = constants.Commands["0401"];
    const packet = mergeData(headerBytes, command.command);
    const buffer = Buffer.from(packet);
    const request = {
        sid: SID,
        command: command,
        options: options,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, request, tag);
    return SID;
};

/**
 * Change PLC to PROGRAM mode
 * FINS command code 0402
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeout` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
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
    if(self.connected !== true) {
        _sendError(self, "not connected", callback, { tag: tag });
        return null;
    }
    const SID = self.header.incrementSID();
    const headerBytes = self.header.bytes(options);
    const command = constants.Commands["0402"];
    const packet = mergeData(headerBytes, command.command);
    const buffer = Buffer.from(packet);
    const request = {
        sid: SID,
        command: command,
        options: options,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, request, tag);
    return SID;
};

/**
 * CPU UNIT DATA READ. Reads CPU Unit data
 * FINS command code 0501
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeout` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
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
    if(self.connected !== true) {
        _sendError(self, "not connected", callback, { tag: tag });
        return null;
    }
    const SID = self.header.incrementSID();
    const headerBytes = self.header.bytes(options);
    const command = constants.Commands["0501"];
    const packet = mergeData(headerBytes, command.command);
    const buffer = Buffer.from(packet);
    const request = {
        sid: SID,
        command: command,
        options: options,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, request, tag);
    return SID;
};

/**
 * Get PLC status
 * FINS command code 0601
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeout` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
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
    if(self.connected !== true) {
        _sendError(self, "not connected", callback, { tag: tag });
        return null;
    }
    const SID = self.header.incrementSID();
    const headerBytes = self.header.bytes(options);
    const command = constants.Commands["0601"];
    const packet = mergeData(headerBytes, command.command);
    const buffer = Buffer.from(packet);
    const request = {
        sid: SID,
        command: command,
        options: options,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, request, tag);
    return SID;
};


/**
 * CLOCK READ. Reads the present year, month, date, minute, second, and day of the week.
 * FINS command code 0701
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeout` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns the SID of the request (returns `null` if any of the command parameters are invalid).
 */
FinsClient.prototype.clockRead = function (opts, tag) {
    /** @type {FinsClient}*/ const self = this;
    const { options, callback } = _normaliseCommandOptions(opts);
    if (self.queueCount() >= self.max_queue) {
        _sendFull(self, callback);
        return null;
    }
    if(self.connected !== true) {
        _sendError(self, "not connected", callback, { tag: tag });
        return null;
    }
    const SID = self.header.incrementSID();
    const headerBytes = self.header.bytes(options);
    const command = constants.Commands["0701"];
    const packet = mergeData(headerBytes, command.command);
    const buffer = Buffer.from(packet);
    const request = {
        sid: SID,
        command: command,
        options: options,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, request, tag);
    return SID;
};

/**
 * CLOCK WRITE. Changes the present year, month, date, minute, second, or day of the week.
 * FINS command code 0702
 * @param {*} clockData - An object containing `{year,month,day,hour,minute,second,day_of_week}` (second & day_of_week are optional)
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeout` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
 * @param {*} [tag=null] - Optional tag item that is sent back in the callback method
 * @returns the SID of the request (returns `null` if any of the command parameters are invalid).
 */
FinsClient.prototype.clockWrite = function ({year,month,day,hour,minute,second,day_of_week}, opts, tag) {
    /** @type {FinsClient}*/ const self = this;
    const { options, callback } = _normaliseCommandOptions(opts);
    if (self.queueCount() >= self.max_queue) {
        _sendFull(self, callback);
        return null;
    }
    if(self.connected !== true) {
        _sendError(self, "not connected", callback, { tag: tag });
        return null;
    }
    const SID = self.header.incrementSID();
    const headerBytes = self.header.bytes(options);
    const command = constants.Commands["0702"];
    const commandData = [dec2bcd(year),dec2bcd(month),dec2bcd(day),dec2bcd(hour),dec2bcd(minute)];
    if(second != null) {
        commandData.push(dec2bcd(second));
        if(day_of_week != null) {
            commandData.push(day_of_week);
        }
    }
    const packet = mergeData(headerBytes, command.command, commandData);
    const buffer = Buffer.from(packet);
    const request = {
        sid: SID,
        command: command,
        options: options,
        callback: callback
    };
    _transmitCommand(self, SID, buffer, request, tag);
    return SID;
};

/**
 * Generic command 
 * @param {string} commandCode 4 digit command code. e.g. 0101 MEMORY AREA READ
 * @param {Any[]} params associated command parameters
 * @param {CommandOptions|CommandCallback} [opts=null] - Optional. If opts is an object, it can contain `.timeout` and `.DNA` `.DA1` `.DA2` numbers (for routing) and a `.callback` method `(err, msg) => {}`  If opts is a callback function, it should have the signature `(err, msg) => {}`
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
    if(self.connected !== true) {
        _sendError(self, "not connected", callback, { tag: tag });
        return null;
    }
    const cmd =  constants.Commands[commandCode];
    if(!cmd) {
        _sendError(self, `commandCode '${commandCode}' not recognised`, callback, { tag: tag });
        return null;
    }

    //basic parameter check
    if(cmd.params && cmd.params.length) {
        for (let index = 0; index < cmd.params.length; index++) {
            const expectedParam = cmd.params[index];
            const providedParam = params[index];
            if(!providedParam && expectedParam.required) {
                _sendError(self, `Parameter ${index+1} Missing. Expected '${expectedParam.name}'`, callback, { tag: tag });
            }
            if(expectedParam.type == null || expectedParam.type == "*" || expectedParam.type == "Any") {
                //param type ok
            } else if(typeof providedParam !== expectedParam.type) {
                _sendError(self, `Parameter ${index+1} '${expectedParam.name}' incorrect type. Expected type of '${expectedParam.type}'`, callback, { tag: tag });
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
    } else if(cmd.name == "clock-read") {
        return self.clockRead(options, tag);
    } else if(cmd.name == "clock-write") {
        return self.clockWrite(params[0], options, tag);
    } else {
        _sendError(self, `command not recognised`, callback, { tag: tag });
        return null;
    }
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

//#endregion


//#region Socket Handlers

function socket_initialised() {
    /** @type {FinsClient}*/ const self = this;
    self.initialised = true;
    self.emit('initialised', self.options);
}

function socket_listening() {
    /** @type {FinsClient}*/ const self = this;
    self.emit('open', self.remoteInfo);
    self.connected = true;
}

// eslint-disable-next-line no-unused-vars
function tcp_socket_init_listening(err, data) {
    /** @type {FinsClient}*/ const self = this;
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

function tcp_socket_init_receive(data) {
    /** @type {FinsClient}*/ const self = this;

    if (data.length != 24) {
        self._socket_handler_tcp_init_error(new Error("Initial response is invalid - expected 24 bytes"));
        return;
    }

    const magic = data.slice(0, 4).toString();

    self.client_node_no = data[19]; //My node no
    self.server_node_no = data[23]; //PLC node no

    if (magic !== "FINS") {
        self._socket_handler_tcp_init_error(new Error("Initial response is invalid - expected for find 'FINS' at the beginning of the packet"));
        return;
    }
    self.tcp_socket.off("data", self._socket_handler_tcp_init_receive);
    self.tcp_socket.on("data", self._socket_handler_receive);
    self._socket_handler_listening();
}

function socket_close() {
    /** @type {FinsClient}*/ const self = this;
    self.emit('close');
    self.connected = false;
}

function socket_error(err) {
    /** @type {FinsClient}*/ const self = this;
    self.emit('error', err);
}

function socket_receive(buf, rinfo) {
    /** @type {FinsClient}*/ const self = this;
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
        const response = self.processReply(buffer, rinfo);
        if (typeof response === "object") {
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
        } else if(response === -1){
            //error already sent
        } else {
            throw new Error("Unable to process the PLC reply");
        }
    }
}

//#endregion


//#region Supporting functions

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
            if(!fcInstance.tcp_socket || !fcInstance.connected) {
                cb(new Error("not connected"));
            } else {                
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
            }
        } else {
            if(!fcInstance.socket || !fcInstance.connected) {
                cb(new Error("not connected"));
            } else {
                fcInstance.socket.send(buffer, cb);
            }
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

function _initialProcessing(buf, /** @type {SequenceManager} */sequenceManager, fnName, expectedCmdCode ) {
    const sid = buf[9];
    const responseCommandCode = _getResponseCommandCode(buf[10], buf[11]);
    const seq = sequenceManager && sequenceManager.get(sid);
    if(!seq || sid > sequenceManager.maxSID || sid < sequenceManager.minSID) {
        throw new Error(`Unexpected SID '${sid}' received`);
    }
    expectedCmdCode = expectedCmdCode || constants.Commands[responseCommandCode].commandCode
    if (responseCommandCode !== expectedCmdCode) {
        throw new Error(`Unexpected command code response. Expected '${expectedCmdCode}' received '${responseCommandCode}'`);
    }    
    fnName = fnName || constants.Commands[responseCommandCode].name;
    if (seq.request.command.name !== fnName) {
        throw new Error(`Unexpected function type response. Expected '${fnName}' received '${seq.request.command.name}'`);
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
        result: {
            CPUUnitModel: CPUUnitModel.toString().trim(),
            CPUUnitInternalSystemVersion: CPUUnitInternalSystemVersion.toString().trim(),
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
        }
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
        result: {
            status: getKeyName(statusCodes, status),
            mode: getKeyName(runModes, mode),
            fatalErrors: (fed ? fatalErrorData : null),
            nonFatalErrors: (nfed ? nonFatalErrorData : null),
            plcErrCode: plcErrCode,
            plcMessage: plcMessage
        }
    };
}


function _processClockRead(buf, rinfo, sequenceManager) {
    const fnName = "clock-read";
    const cmdCode = "0701"
    const {sid, command} = _initialProcessing(buf, sequenceManager, fnName, cmdCode);
    const dataStart = 14;

    /*
    BYTE
    0    1     2   3    4       5      6
    Year Month Day Hour Minute  Second Day of week
    */
    const year = buf[dataStart+0];
    const month = buf[dataStart+1];
    const day = buf[dataStart+2];
    const hour = buf[dataStart+3];
    const minute = buf[dataStart+4];
    const second = buf[dataStart+5];
    const day_of_week = buf[dataStart+6];
    


    const clock = {
        year: bcd2dec(year),
        month: bcd2dec(month),
        day: bcd2dec(day),
        hour: bcd2dec(hour),
        minute: bcd2dec(minute),
        second: bcd2dec(second),
        day_of_week: day_of_week,
    }

    return {
        remoteHost: rinfo.address,
        sid: sid,
        command: command,
        result: clock
    };
}

/**
 * Process data for Memory Read Area
 * @param {Buffer} buf Data returned from PLC
 * @param {object} rinfo Remote Host Info
 * @param {SequenceManager} sequenceManager 
 * @returns 
 */
function _processMemoryAreaRead(buf, rinfo, sequenceManager) {
    const fnName = "read";
    const cmdCode = "0101"
    const {sid, seq, command} = _initialProcessing(buf, sequenceManager, fnName, cmdCode);
    const bufData = (buf.slice(14, buf.length));
    const plcAddress = seq.request && seq.request.address;
    const bitValues = plcAddress && plcAddress.isBitAddress == true;
    const dataElementLength = plcAddress && plcAddress.elementLength;
    let values;

    if (bitValues) {
        values = [];
        values.push(...bufData);
    } else if (dataElementLength === 4) {
        values = [];
        for (let i = 0; i < bufData.length; i += 4) {
            values.push(bufData.readInt32BE(i));
        }
    } else {
        values = [];
        for (let i = 0; i < bufData.length; i += 2) {
            values.push(bufData.readInt16BE(i));
        }
    }

    return {
        remoteHost: rinfo.address,
        sid: sid,
        command: command,
        commandDescription: "read",
        values: values,
        buffer: bufData,
    };
}

/**
 * Process data for Multiple Memory Read Area
 * @param {Buffer} buf Data returned from PLC
 * @param {object} rinfo Remote Host Info
 * @param {SequenceManager} sequenceManager 
 * @returns 
 */
function _processMultipleMemoryAreaRead(buf, rinfo, sequenceManager) {
    const fnName = 'read-multiple';
    const cmdCode = '0104'
    const {sid, seq, command} = _initialProcessing(buf, sequenceManager, fnName, cmdCode);
    const data = [];
    const bufData = (buf.slice(14));
    const memoryAddressList = [...seq.request.address];

    for (var i = 0; i < bufData.length;) {
        const plcAddress = memoryAddressList.shift();
        const memAreaCode = bufData[i++];
        if (!plcAddress || plcAddress.memoryAreaCode !== memAreaCode) {
            throw new Error(`Unexpected memory address in response. Expected '${plcAddress.memoryAreaCode}', Received ${memAreaCode}`);
        }
        if (plcAddress.isBitAddress) {
            data.push(bufData[i]);
            i++; // move to the next memory area
        } else if (plcAddress.elementLength === 4) {
            data.push(bufData.readInt32BE(i));
            i = i + 4; // move to the next memory area
        } else {
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

function _processReply(buf, rinfo) {
    const self = this;
    let processResult;
    const responseCommandCode = _getResponseCommandCode(buf[10], buf[11]);
    const processEndCode = _processEndCode(buf[12], buf[13]);
    const sid = buf[9];
    const seq = self.sequenceManager.get(sid);
    const callback = seq && seq.request && seq.request.callback;

    try {
        switch (responseCommandCode) {
        case CPU_UNIT_STATUS_READ:
            processResult = _processStatusRead(buf, rinfo, self.sequenceManager);
            break;
        case CPU_UNIT_DATA_READ:
            processResult = _processCpuUnitDataRead(buf, rinfo, self.sequenceManager);
            break;
        case MEMORY_AREA_READ:
            processResult = _processMemoryAreaRead(buf, rinfo, self.sequenceManager);
            break;
        case CLOCK_READ:
            processResult = _processClockRead(buf, rinfo, self.sequenceManager);
            break;
        case MEMORY_AREA_READ_MULTI:
            processResult = _processMultipleMemoryAreaRead(buf, rinfo, self.sequenceManager);
            break;
        case MEMORY_AREA_WRITE:
        case MEMORY_AREA_FILL:
        case MEMORY_AREA_TRANSFER:
        case STOP:
        case RUN:
        case CLOCK_WRITE:
            processResult = _processDefault(buf, rinfo, self.sequenceManager);
            break;
        default:
            throw new Error(`Unrecognised response code '${responseCommandCode}'`);
        }
        processResult.endCode = processEndCode.endCode;
        processResult.endCodeDescription = processEndCode.endCodeDescription;
        processResult.MRES = processEndCode.MRES;
        processResult.SRES = processEndCode.SRES;
        processResult.NetworkRelayError = processEndCode.NetworkRelayError;
        processResult.NonFatalCPUUnitErr = processEndCode.NonFatalCPUUnitErr;
        processResult.FatalCPUUnitErr = processEndCode.FatalCPUUnitErr;
        return processResult;
    } catch (error) {
        _sendError(self, error, callback, seq);
        return -1;
    }

}

function _sendError(self, error, callback, seq) {
    const err = typeof error == "object" && error.message ? error : new Error(error);
    if (callback) {
        callback(err, seq);
    } else if (self) {
        self.emit('error', err, seq);
    } else {
        throw err
    }
}

function _sendFull(self, callback) {
    if (callback) {
        callback("full", null);
    }
    self.emit("full");
}

//#endregion