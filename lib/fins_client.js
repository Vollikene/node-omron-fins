var dgram = require('dgram');
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var constants = require('./constants');

module.exports = FinsClient;

function FinsClient(port, host, options) {
    if (!(this instanceof FinsClient)) return new FinsClient(port, host, options);
    EventEmitter.call(this);
    this.init(port, host, options);
}

inherits(FinsClient, EventEmitter);

function SequenceManager(parent, opts) {
    const Statistics = function (sampleSize) {
        const size = sampleSize || 50;
        var index, replyCount, minReplyMS, maxReplyMS, errorCount, timeoutCount, array;
        var startTime = Date.now();
        var mspTimer, mpsCounter, mps;
        _init();
        function _init() {
            index = replyCount = errorCount = timeoutCount = maxReplyMS = 0;
            mpsCounter = mps = 0;
            minReplyMS = Number.MAX_VALUE;
            array = new Array(sampleSize);
            for (let index = 0; index < sampleSize; index++) {
                array[index] = 0;
            }
            if (mspTimer) clearInterval(mspTimer);
            mspTimer = setInterval(function interval() {
                mps = mpsCounter;
                mpsCounter = 0;
            }, 1000);
        }
        return {
            addReply: function (ms) {
                replyCount++;
                mpsCounter++;
                if (index >= array.length) index = 0;
                array[index++] = ms;
                if (ms > maxReplyMS) maxReplyMS = ms;
                if (ms < minReplyMS) minReplyMS = ms;
                return this.stats();
            },
            addError: function () {
                errorCount++;
                return this.stats();
            },
            addTimeout: function () {
                timeoutCount++;
                return this.stats();
            },
            stats: function () {
                var _count = (replyCount > sampleSize ? sampleSize : replyCount) || 1;
                var sum = array.reduce(function (a, b) {
                    return a + b;
                }, 0);
                var avg = (sum / _count) || 0;
                return {
                    replyCount: replyCount,
                    errorCount: errorCount,
                    timeoutCount: timeoutCount,
                    minReplyMS: minReplyMS,
                    maxReplyMS: maxReplyMS,
                    msgPerSec: mps,
                    averageReplyMS: avg,
                    runtimeMS: Date.now() - startTime
                };
            },
            reset: function () {
                _init();
            },
            close: function () {
                console.debug("cleaing up ");
                if (mspTimer) clearInterval(mspTimer);
            }
        };
    };
    var statisics = Statistics(50);
    var parent = parent;
    opts = opts || {};
    var options = {
        minSID: opts.minSID || 1,
        maxSID: opts.maxSID || 254,
        timeoutMS: opts.timeoutMS || 10000
    };
    const capacity = (options.maxSID - options.minSID) + 1;
    var sequences = {};
    return {
        sequences: function () {
            return sequences;
        },
        freeSpace: function () {
            //future speed up - dont recalculate, instead, inc/dec an in-use counter
            return capacity - this.activeCount();
        },
        activeCount: function () {
            //future speed up - dont recalculate, instead, inc/dec an in-use counter
            return Object.values(sequences).reduce(function (a, v) {
                return v && v.sid && !v.complete && !v.timeout && !v.error ? a + 1 : a;
            }, 0);
        },
        add: function (SID, request, tag) {
            if (SID >= options.minSID && SID <= options.maxSID) {
                let seq = sequences[SID];
                if (seq && !seq.complete && !seq.timeout) {
                    throw new Error("This SID is already waiting a reply");
                }
                seq = {
                    sid: SID,
                    request: request,
                    tag: tag || null,
                    sent: false,
                    complete: false,
                    timeout: false,
                    error: false,
                    createTime: Date.now(),
                };
                sequences[SID] = seq;
                seq.timer = setTimeout(function () {
                    if (seq.complete || seq.error) return;
                    seq.timeout = true;
                    seq.stats = statisics.addTimeout();
                    if (seq.callback) {
                        seq.callback(new Error("timeout"), seq);
                    } else {
                        parent.emit('timeout', parent.host, seq);
                    }
                }, options.timeoutMS);
                return seq;
            }
        },
        get: function (SID) {
            if (SID >= options.minSID && SID <= options.maxSID) {
                return sequences[SID];
            }
        },
        done: function (SID) {
            let seq = this.get(SID);
            if (seq) {
                seq.complete = true;
                seq.replyTime = Date.now();
                if (seq.timer) {
                    clearTimeout(seq.timer);
                    seq.timer = null;
                    delete seq.timer;
                }
                seq.timeTaken = seq.replyTime - seq.createTime;
                seq.stats = statisics.addReply(seq.timeTaken);
            }
        },
        setError: function (SID, err) {
            let seq = this.get(SID);
            if (seq) {
                seq.stats = statisics.addError();
                seq.error = err;
                if (seq.timer) {
                    clearTimeout(seq.timer);
                    seq.timer = null;
                    delete seq.timer;
                }
                if (seq.callback) {
                    seq.callback(err, seq);
                } else {
                    parent.emit('error', err, seq);
                }
            }
        },
        confirmSent: function (SID) {
            let seq = this.get(SID);
            if (seq) {
                seq.sentTime = Date.now();
                seq.sent = true;
            }
        },
        delete: function (SID) {
            let seq = this.get(SID);
            if (seq) {
                if (seq.timer) {
                    clearTimeout(seq.timer);
                    seq.timer = null;
                    delete seq.timer;
                }
                sequences[SID] = null; //TODO: consider object reuse!
                delete sequences[SID];
            }
        },
        close: function () {
            statisics.close();
            for (let _SID = options.minSID; _SID < options.maxSID; _SID++) {
                try {
                    this.delete(_SID);
                } catch (error) { }
            }
        }
    };
}

_compareArrays = function (a, b) {
    if (a.length !== b.length)
        return false;
    for (var i = a.length; i--;) {
        if (a[i] !== b[i])
            return false;
    }
    return true;
};


_mergeArrays = function (array) {
    return array.reduce(function (flat, toFlatten) {
        return flat.concat(Array.isArray(toFlatten) ? _mergeArrays(toFlatten) : toFlatten);
    }, []);
};


_keyFromValue = function (dict, value) {
    var key = Object.keys(dict)
        .filter(function (key) {
            return dict[key] === value;
        }
        )[0];

    return key;
};



_padHex = function (width, number) {
    return ("0" * width + number.toString(16).substr(-width));
};



_wordsToBytes = function (words) {
    var bytes = [];
    if (!words.length) {
        bytes.push((words & 0xff00) >> 8);
        bytes.push((words & 0x00ff));
    } else {
        for (var i in words) {
            bytes.push((words[i] & 0xff00) >> 8);
            bytes.push((words[i] & 0x00ff));
        }
    }
    return bytes;

};

_decodedAddressToString = function (decodedMemoryAddress, offsetWD, offsetBit) {
    offsetWD = isInt(offsetWD, 0);
    if (decodedMemoryAddress.Bit) {
        offsetBit = isInt(offsetBit, 0);
        return `${decodedMemoryAddress.MemoryArea}${parseInt(decodedMemoryAddress.Address) + offsetWD}.${decodedMemoryAddress.Bit + offsetBit}`;
    }
    return `${decodedMemoryAddress.MemoryArea}${parseInt(decodedMemoryAddress.Address) + offsetWD}`;
};

_decodeMemoryAddress = function (addressString) {
    var re = /([A-Z]*)([0-9]*)\.?([0-9]*)/;//normal address Dxxx Cxxx    
    if (addressString.includes("_"))
        re = /(.+)_([0-9]*)\.?([0-9]*)/; //handle Ex_   basically E1_ is same as E + 1 up to 15 then E16_=0x60 ~ 0x68
    var matches = addressString.match(re);
    var decodedMemory = {
        'MemoryArea': matches[1],
        'Address': matches[2],
        'Bit': matches[3]
    };
    return decodedMemory;
};

_translateMemoryAddressString = function (addressString, memoryAreas) {
    var decodedMemoryAddress = _decodeMemoryAddress(addressString);
    return _translateMemoryAddress(decodedMemoryAddress, memoryAreas);
};

_translateMemoryAddress = function (decodedMemoryAddress, memoryAreas) {

    var temp = [];
    var byteEncodedMemory = [];

    var memAreaCode = memoryAreas[decodedMemoryAddress.MemoryArea]; //get INT value for desired Memory Area (e.g. D=0x82)
    if (!memAreaCode) {
        return null;//null? something else? throw error?
    }
    var memAreaAddress = memoryAreas.CalculateMemoryAreaAddress(decodedMemoryAddress.MemoryArea, decodedMemoryAddress.Address);//Calculate memAreaAddress value (e.g. C12 = 12 + 0x8000 )

    temp.push([memAreaCode]);
    temp.push(_wordsToBytes([memAreaAddress]));
    temp.push([0x00]);//TODO: handle bit addresses 
    byteEncodedMemory = _mergeArrays(temp);

    return byteEncodedMemory;


};

_incrementSID = function (sid) {
    return (sid % 254) + 1;
};

_buildHeader = function (header) {
    var builtHeader = [
        header.ICF,
        header.RSV,
        header.GCT,
        header.DNA,
        header.DA1,
        header.DA2,
        header.SNA,
        header.SA1,
        header.SA2,
        header.SID
    ];
    return builtHeader;

};

_buildPacket = function (raw) {
    var packet = [];
    packet = _mergeArrays(raw);
    return packet;
};

_getResponseType = function (buf) {
    var response = [];
    response.push(buf[10]);
    response.push(buf[11]);
    return response;
};

_processEndCode = function (hiByte, loByte) {
    var MRES = hiByte, SRES = loByte;
    var NetworkRelayError = ((MRES & 0x80) > 0);
    var NonFatalCPUUnitErr = ((SRES & 0x40) > 0);
    var FatalCPUUnitErr = ((SRES & 0x80) > 0);
    MRES = (MRES & 0x3f);
    SRES = (SRES & 0x2f);
    var endCode = ((MRES << 8) + SRES).toString(16); //.padStart(4,"0"); NodeJS8+
    while(endCode.length < 4) {
        endCode = "0" + endCode;
    }
    var endCodeDescription = constants.EndCodeDescriptions[endCode];
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

_processDefault = function (buf, rinfo) {
    var sid = buf[9];
    var command = (buf.slice(10, 12)).toString("hex");
    return { remoteHost: rinfo.address, sid: sid, command: command };
};

_processStatusRead = function (buf, rinfo) {
    var sid = buf[9];

    var command = (buf.slice(10, 12)).toString("hex");
    var status = buf[14];
    var mode = buf[15];
    var fatalErrorData = {};
    var nonFatalErrorData = {};
    for (var i in constants.FatalErrorData) {
        if ((buf.readInt16BE(17) & constants.FatalErrorData[i]) != 0);
        fatalErrorData.push(i);
    }

    for (var j in constants.nonFatalErrorData) {
        if ((buf.readInt16BE(18) & constants.nonFatalErrorData[j]) != 0)
            nonFatalErrorData.push(j);
    }
    var statusCodes = constants.Status;
    var runModes = constants.Modes;


    return {
        remoteHost: rinfo.address,
        sid: sid,
        command: command,
        commandDescription: "status",
        status: _keyFromValue(statusCodes, status),
        mode: _keyFromValue(runModes, mode),
        fatalErrorData: fatalErrorData || null,
        nonFatalErrorData: nonFatalErrorData || null
    };
};

_processMemoryAreaRead = function (buf, rinfo) {
    var data = [];
    var sid = buf[9];
    var command = (buf.slice(10, 12)).toString("hex");
    var bufData = (buf.slice(14, buf.length));
    for (var i = 0; i < bufData.length; i += 2) {
        data.push(bufData.readInt16BE(i));
    }
    return {
        remoteHost: rinfo.address,
        sid: sid,
        command: command,
        commandDescription: "read",
        values: data,
        buffer: bufData
    };
};

_processReply = function (buf, rinfo) {
    var commands = constants.Commands;
    var responseType = (_getResponseType(buf)).join(' ');   
    var processEndCode = _processEndCode(buf[12],buf[13]);
    var processResult;
    switch (responseType) {
        case commands.CONTROLLER_STATUS_READ.join(' '):
            processResult = _processStatusRead(buf, rinfo);
            break;
        case commands.MEMORY_AREA_READ.join(' '):
            processResult = _processMemoryAreaRead(buf, rinfo);
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
_decodePacket = function (buf, rinfo) {
    var data = [];
    var command = (buf.slice(10, 12)).toString("hex");
    var endCode = (buf.slice(12, 14)).toString("hex");
    var endCodeDescription = constants.EndCodeDescriptions[endCode];

    var values = (buf.slice(14, buf.length));
    for (var i = 0; i < values.length; i += 2) {
        data.push(values.readInt16BE(i));
    }
    return { remoteHost: rinfo.address, command: command, endCode: endCode, endCodeDescription: endCodeDescription, values: data };
};

_sendParamError = function (message, callback, seq) {
    var addrErr = Error(message);
    if(callback) {
        callback(addrErr, seq)
    } else {
        self.emit('error', addrErr, seq);
    }
}
function isInt(x, def) {
    var v;
    try {
        v = parseInt(x);
        if (isNaN(v))
            return def;
    } catch (e) {
        return def;
    }
    return v;
}

FinsClient.prototype.init = function (port, host, options) {
    var self = this;
    var defaultHost = constants.DefaultHostValues;
    var defaultOptions = constants.DefaultOptions;
    this.port = port || defaultHost.port;
    this.host = host || defaultHost.host;
    this.options = options || {};
    this.timeout = (this.options.timeout) || defaultOptions.timeout || 5000;
    this.max_queue = (this.options.max_queue) || defaultOptions.max_queue || 100;
    this.memoryAreas = constants.CSCJ_MODE_WD_MemoryAreas;
    this.sequenceManager = SequenceManager(self, { timeoutMS: 1000 });
    if (this.options.MODE == "NJNX") {
        this.memoryAreas = constants.NJNX_MODE_WD_MemoryAreas;
    } else if (this.options.MODE == "CV") {
        this.memoryAreas = constants.CV_MODE_WD_MemoryAreas;
    }
    //cleanup (if reconnecting, socket might be initialised)
    if (this.socket) {
        this.socket.removeAllListeners();
        delete this.socket;
    }
    this.socket = dgram.createSocket('udp4');

    this.header = Object.assign({}, constants.DefaultFinsHeader);
    this.header.ICF = isInt(this.options.ICF, constants.DefaultFinsHeader.ICF);
    this.header.DNA = isInt(this.options.DNA, constants.DefaultFinsHeader.DNA);
    this.header.DA1 = isInt(this.options.DA1, constants.DefaultFinsHeader.DA1);
    this.header.DA2 = isInt(this.options.DA2, constants.DefaultFinsHeader.DA2);
    this.header.SNA = isInt(this.options.SNA, constants.DefaultFinsHeader.SNA);
    this.header.SA1 = isInt(this.options.SA1, constants.DefaultFinsHeader.SA1);
    this.header.SA2 = isInt(this.options.SA2, constants.DefaultFinsHeader.SA2);

    this.connected = false;
    self.requests = {};
    self.emit('initialised', this.options);

    function receive(buf, rinfo) {
        var response = _processReply(buf, rinfo);
        if (response) {
            self.sequenceManager.done(response.sid);//1st, cancel the timeout
            var seq = self.sequenceManager.get(response.sid);//now get the sequence
            if (seq) {
                seq.response = response;
                var request = seq.request;
                if (request && request.callback) {
                    request.callback(seq);
                }
                self.emit('reply', seq);
                self.sequenceManager.delete(response.sid);
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

    this.socket.on('message', receive);
    this.socket.on('listening', listening);
    this.socket.on('close', close);
    this.socket.on('error', error);

};

FinsClient.prototype.reconnect = function () {
    var self = this;
    self.init(self.port, self.host, self.options);
};

FinsClient.prototype.read = function (address, count, callback, tag) {
    var self = this;
    if (self.queueCount() >= self.max_queue) {
        // console.warn("queue count exceeded")
        self.emit('full');
        return null;
    }
    var memoryAddress = _decodeMemoryAddress(address);
    var addressData = _translateMemoryAddress(memoryAddress, this.memoryAreas);
    if (!addressData) {
        _sendParamError("address is invalid", callback, {tag: tag});
        return null;
    }
    if (!count) {
        _sendParamError("count is empty", callback, {tag: tag});
        return null;
    }
    var SID = self.header.SID = _incrementSID(self.header.SID);
    var header = _buildHeader(self.header);
    var command = constants.Commands.MEMORY_AREA_READ;
    var commandData = [addressData, _wordsToBytes(count)];
    var packet = _buildPacket([header, command, commandData]);
    var buffer = new Buffer(packet);
    var _req = {
        sid: SID,
        functionName: "read",
        address: memoryAddress,
        count: count,
        callback: callback
    };
    var seq = self.sequenceManager.add(SID, _req, tag);
    seq.sendBuff = Buffer.from(buffer);//TEMP
    this.socket.send(buffer, 0, buffer.length, self.port, self.host, function (err) {
        if (err) {
            self.sequenceManager.setError(SID, err);
        } else {
            self.sequenceManager.confirmSent(SID);
        }
    });
    return SID;
};

FinsClient.prototype.write = function (address, dataToWrite, callback, tag) {
    var self = this;
    if (self.queueCount() >= self.max_queue) {
        self.emit('full');
        return null;
    }
    var memoryAddress = _decodeMemoryAddress(address);
    var addressData = _translateMemoryAddress(memoryAddress, this.memoryAreas);
    if (!addressData) {
        _sendParamError("address is invalid", callback, {tag: tag});
        return null;
    }
    if (!dataToWrite || !dataToWrite.length) {
        _sendParamError("dataToWrite is empty", callback, {tag: tag});
        return null;
    }
    var SID = self.header.SID = _incrementSID(self.header.SID);
    var header = _buildHeader(self.header);
    var regsToWrite = _wordsToBytes((dataToWrite.length || 1));
    var command = constants.Commands.MEMORY_AREA_WRITE;
    var dataBytesToWrite = _wordsToBytes(dataToWrite);
    var commandData = [addressData, regsToWrite, dataBytesToWrite];
    var packet = _buildPacket([header, command, commandData]);
    var buffer = new Buffer(packet);
    var _req = {
        sid: SID,
        functionName: "write",
        address: memoryAddress,
        dataBytesToWrite: dataBytesToWrite,
        callback: callback
    };
    var seq = self.sequenceManager.add(SID, _req, tag);
    this.socket.send(buffer, 0, buffer.length, self.port, self.host, function (err) {
        if (err) {
            self.sequenceManager.setError(SID, err);
        } else {
            self.sequenceManager.confirmSent(SID);
        }
    });
    return SID;
};

FinsClient.prototype.fill = function (address, dataToWrite, regsToWrite, callback, tag) {
    var self = this;
    if (self.queueCount() >= self.max_queue) {
        self.emit('full');
        return null;
    }
    var memoryAddress = _decodeMemoryAddress(address);
    var addressData = _translateMemoryAddress(memoryAddress, this.memoryAreas);
    if (!addressData) {
        _sendParamError("address is invalid", callback, {tag: tag});
        return null;
    }
    var SID = self.header.SID = _incrementSID(self.header.SID);
    var header = _buildHeader(self.header);
    var command = constants.Commands.MEMORY_AREA_FILL;
    var dataBytesToWrite = _wordsToBytes(dataToWrite);
    var commandData = [address, _wordsToBytes(regsToWrite), dataBytesToWrite];
    var packet = _buildPacket([header, command, commandData]);
    var buffer = new Buffer(packet);
    var _req = {
        sid: SID,
        functionName: "fill",
        address: memoryAddress,
        count: regsToWrite,
        dataBytesToWrite: dataBytesToWrite,
        callback: callback
    };
    var seq = self.sequenceManager.add(SID, _req, tag);
    this.socket.send(buffer, 0, buffer.length, self.port, self.host, function (err) {
        if (err) {
            self.sequenceManager.setError(SID, err);
        } else {
            self.sequenceManager.confirmSent(SID);
        }
    });
    return SID;
};

FinsClient.prototype.run = function (callback, tag) {
    var self = this;
    if (self.queueCount() >= self.max_queue) {
        self.emit('full');
        return null;
    }
    var SID = self.header.SID = _incrementSID(self.header.SID);
    var header = _buildHeader(self.header);
    var command = constants.Commands.RUN;
    var packet = _buildPacket([header, command]);
    var buffer = new Buffer(packet);
    var _req = {
        sid: SID,
        functionName: "run",
        callback: callback
    };
    var seq = self.sequenceManager.add(SID, _req, tag);
    this.socket.send(buffer, 0, buffer.length, self.port, self.host, function (err) {
        if (err) {
            self.sequenceManager.setError(SID, err);
        } else {
            self.sequenceManager.confirmSent(SID);
        }
    });
    return SID;
};

FinsClient.prototype.stop = function (callback, tag) {
    var self = this;
    if (self.queueCount() >= self.max_queue) {
        self.emit('full');
        return null;
    }
    var SID = self.header.SID = _incrementSID(self.header.SID);
    var header = _buildHeader(self.header);
    var command = constants.Commands.STOP;
    var packet = _buildPacket([header, command]);
    var buffer = new Buffer(packet);
    var _req = {
        sid: SID,
        functionName: "stop",
        callback: callback
    };
    var seq = self.sequenceManager.add(SID, _req, tag);
    this.socket.send(buffer, 0, buffer.length, self.port, self.host, function (err) {
        if (err) {
            self.sequenceManager.setError(SID, err);
        } else {
            self.sequenceManager.confirmSent(SID);
        }
    });
    return SID;
};


FinsClient.prototype.status = function (callback, tag) {
    var self = this;
    if (self.queueCount() >= self.max_queue) {
        self.emit('full');
        return null;
    }
    var SID = self.header.SID = _incrementSID(self.header.SID);
    var header = _buildHeader(self.header);
    var command = constants.Commands.CONTROLLER_STATUS_READ;
    var packet = _buildPacket([header, command]);
    var buffer = new Buffer(packet);
    var _req = {
        sid: SID,
        functionName: "status",
        callback: callback
    };
    var seq = self.sequenceManager.add(SID, _req, tag);
    this.socket.send(buffer, 0, buffer.length, self.port, self.host, function (err) {
        if (err) {
            self.sequenceManager.setError(SID, err);
        } else {
            self.sequenceManager.confirmSent(SID);
        }
    });
    return SID;
};


FinsClient.prototype.close = function () {
    this.connected = false;
    this.sequenceManager.close();
    this.socket.close();
    this.socket.removeAllListeners();
    this.emit('close');//HACK: - cant get socket "close" event to fire
};

FinsClient.prototype.decodeMemoryAddress = function (addressString) {
    return _decodeMemoryAddress(addressString);
};

FinsClient.prototype.decodedAddressToString = function (decodedAddress, offsetWD, offsetBit) {
    return _decodedAddressToString(decodedAddress, offsetWD, offsetBit);
};

FinsClient.prototype.queueCount = function () {
    var self = this;
    return self.sequenceManager.activeCount();
};
