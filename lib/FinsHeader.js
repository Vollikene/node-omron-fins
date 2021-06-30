const { isInt } = require('./FinsDataUtils');
const constants = require('./FinsConstants');


function FinsHeader(options) {
    options = options || {};
    let _ICF = isInt(options.ICF, constants.DefaultFinsHeader.ICF);
    let _RSV = isInt(options.RSV, constants.DefaultFinsHeader.RSV);
    let _GCT = isInt(options.GCT, constants.DefaultFinsHeader.GCT);
    let _DNA = isInt(options.DNA, constants.DefaultFinsHeader.DNA);
    let _DA1 = isInt(options.DA1, constants.DefaultFinsHeader.DA1);
    let _DA2 = isInt(options.DA2, constants.DefaultFinsHeader.DA2);
    let _SNA = isInt(options.SNA, constants.DefaultFinsHeader.SNA);
    let _SA1 = isInt(options.SA1, constants.DefaultFinsHeader.SA1);
    let _SA2 = isInt(options.SA2, constants.DefaultFinsHeader.SA2);
    let _SID = 0;
    const _minSID = options.minSID || 1;
    const _maxSID = options.maxSID || 254;

    return {
        get ICF() { return _ICF },
        get DNA() { return _DNA },
        get RSV() { return _RSV },
        get GCT() { return _GCT },
        get DA1() { return _DA1 },
        get DA2() { return _DA2 },
        get SNA() { return _SNA },
        get SA1() { return _SA1 },
        get SA2() { return _SA2 },
        get SID() { return _SID >= _minSID && _SID <= _maxSID ? _SID : _minSID },
        bytes(options) {
            options = options || {};
            const builtHeader = [
                this.ICF,
                this.RSV,
                this.GCT,
                options.DNA || this.DNA,
                options.DA1 || this.DA1,
                options.DA2 || this.DA2,
                this.SNA,
                this.SA1,
                this.SA2,
                options.SID || this.SID
            ];
            return builtHeader;
        },
        incrementSID() {
            _SID = (Math.abs(_SID) % 254) + 1;
            if(_SID < _minSID) { _SID = _minSID; }
            if(_SID > _maxSID) { _SID = _maxSID; }
            return _SID;
        }
    }
}
module.exports = FinsHeader;