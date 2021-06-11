function _normaliseBool(value, trueValue, falseValue){
    if (typeof(value) === 'string'){
        value = value.trim().toLowerCase();
    }
    switch(value){
        case true:
        case "true":
        case 1:
        case "1":
        case "on":
        case "yes":
            return trueValue;
        default: 
            return falseValue;
    }
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
};

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
};

function _buildPacket (raw) {
    var packet = [];
    packet = _mergeArrays(raw);
    return packet;
};


function _mergeArrays (array) {
    return array.reduce(function (flat, toFlatten) {
        return flat.concat(Array.isArray(toFlatten) ? _mergeArrays(toFlatten) : toFlatten);
    }, []);
};

function _keyFromValue (dict, value) {
    var key = Object.keys(dict)
        .filter(function (key) {
            return dict[key] === value;
        }
        )[0];
    return key;
};


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
    buildPacket: _buildPacket,
    mergeArrays: _mergeArrays,
    getKeyName: _keyFromValue,
    isInt: _isInt,
};