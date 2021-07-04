const allowableTrueValues = {
    1: true,
    true: true,
    "on": true
}
const allowableFalseValues = {
    0: true,
    false: true,
    "off": true
}
function _normaliseBool(value, trueValue, falseValue){
    if (typeof(value) === 'string'){
        value = value.trim().toLowerCase();
    }
    if(allowableTrueValues[value]) {
        return trueValue == null ? true: trueValue;
    }
    if(allowableFalseValues[value]) {
        return typeof falseValue == "undefined" ? false : falseValue;
    }
    throw new Error("Invalid boolean value")
}

function _boolsToBytes (data) {
    let bytes;
    if (data != null) {
        bytes = [];
        let bits = data;
        if (Array.isArray(bits) == false) {
            bits = [bits];
        }
        for (let i = 0; i < bits.length; i++) {
            bytes.push(_normaliseBool(bits[i], 1 , 0));
        }
    }
    return bytes;
}

function _wordsToBytes (data) {
    var bytes;
    if (data != null) {
        bytes = [];
        let words = data;
        if (Array.isArray(words) == false) {
            words = [words];
        }
        for (let i = 0; i < words.length; i++) {
            bytes.push((words[i] & 0xff00) >> 8);
            bytes.push((words[i] & 0x00ff));
        }
    }
    return bytes;
}

function _dwordsToBytes (data) {
    /** @type {Buffer}*/let buf;
    if (data != null) {
        let words = data;
        if (Array.isArray(words) == false) {
            words = [words];
        }
        buf = Buffer.alloc(words.length * 4);
        for (let i = 0; i < words.length; i++) {
            buf.writeUInt32BE(words[i]);
        }
    }
    return buf && buf.toJSON().data;
}

/**
 * Merge variable numbers and arrays of numbers into a flat array
 * @param {...number|Array<number>|Array<Array<number>>}
 * @returns flat array
 */
function _mergeData () {
    var packet = [];
    packet = _mergeArrays([...arguments]);
    return packet;
}

/**
 * Merge array or array of arrays into a flat array
 * @returns flat array
 */
function _mergeArrays (array) {
    return array.reduce(function (flat, toFlatten) {
        return flat.concat(Array.isArray(toFlatten) ? _mergeArrays(toFlatten) : toFlatten);
    }, []);
}

function _keyFromValue (dict, value) {
    var key = Object.keys(dict)
        .filter(function (key) {
            return dict[key] === value;
        }
        )[0];
    return key;
}


function _isInt(x, def) {
    let v;
    try {
        v = parseInt(x);
        if (isNaN(v))
            return def;
    } catch (e) {
        return def;
    }
    return v;
}

module.exports = {
    normaliseBool: _normaliseBool,
    boolsToBytes: _boolsToBytes,
    wordsToBytes: _wordsToBytes,
    dwordsToBytes: _dwordsToBytes,
    mergeData: _mergeData,
    mergeArrays: _mergeArrays,
    getKeyName: _keyFromValue,
    isInt: _isInt,
    dec2bcd: (dec) => parseInt(dec.toString(10),16),
    bcd2dec: (bcd) => parseInt(bcd.toString(16),10)
};