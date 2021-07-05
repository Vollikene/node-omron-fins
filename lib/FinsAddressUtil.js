const constants = require('./FinsConstants');
const {wordsToBytes, isInt} = require('./FinsDataUtils');


module.exports = FinsAddressUtil;

function FinsAddressUtil(PLCType) {
    /** @type {FinsAddressUtil} */ const self = this;
    self.PLCType = PLCType
    self.memoryAreas = constants.MemoryAreas.CS;
    switch (self.PLCType) {
    case "CV":
        self.memoryAreas = constants.MemoryAreas.CV;
        break;
    case "CS":
    case "CSCJ":
    case "CJ":
    case "CP":
    case "NJ":
    case "NJNX":
    case "NX":
        self.memoryAreas = constants.MemoryAreas.CS;
        break;
    default:
        break;
    }

    /**
     * Encodes a FINS address to the necessary bytes for a FINS command
     * @param {Object} decodedMemoryAddress - a valid Memory Address with `MemoryArea`, Address`, `Bit`
     * @returns The bytes for a FINS command e.g. D0 will be encoded to [130,0,0,0]  D5.1 will be encoded as [2, 0, 80, 1]
     */
    function addressToBytes (decodedMemoryAddress) {
        const memAreas =  decodedMemoryAddress.isBitAddress ? self.memoryAreas.bit : self.memoryAreas.word;
        const byteEncodedMemory = [];
        const memAreaCode = memAreas[decodedMemoryAddress.MemoryArea]; //get INT value for desired Memory Area (e.g. D=0x82)
        if (memAreaCode == null) {
            return null;//null? something else? throw error?
        }
        const memAreaAddress = memAreas.CalculateMemoryAreaAddress(decodedMemoryAddress.MemoryArea, decodedMemoryAddress.Address);//Calculate memAreaAddress value (e.g. C12 = 12 + 0x8000 )
        byteEncodedMemory.push(memAreaCode);
        byteEncodedMemory.push(...wordsToBytes([memAreaAddress]));
        if(decodedMemoryAddress.isBitAddress) {
            byteEncodedMemory.push(decodedMemoryAddress.Bit);//bit addresses 
        } else {
            byteEncodedMemory.push(0x00); //word address 
        }
        return byteEncodedMemory;
    }

    function addressToString (decodedMemoryAddress, offsetWD, offsetBit) {
        offsetWD = isInt(offsetWD, 0);
        if (decodedMemoryAddress.isBitAddress) {
            if(decodedMemoryAddress.MemoryArea === "C" || decodedMemoryAddress.MemoryArea === "T") {
                return `${decodedMemoryAddress.MemoryArea}${parseInt(decodedMemoryAddress.Address) + offsetWD}.x`;        
            }
            offsetBit = isInt(offsetBit, 0);
            return `${decodedMemoryAddress.MemoryArea}${parseInt(decodedMemoryAddress.Address) + offsetWD}.${decodedMemoryAddress.Bit + offsetBit}`;
        }
        return `${decodedMemoryAddress.MemoryArea}${parseInt(decodedMemoryAddress.Address) + offsetWD}`;
    }
    
    function stringToAddress(addressString) {
        let re = /([A-Z]*)([0-9]*)\.?([0-9|x|X]*)/;//normal address CIOnnn CIOnnn.0 Dnnn Cnnn Cnnn Tnnn Cnnn.x Tnnn.x
        if (addressString.includes('_')) {
            re = /(.+)_([0-9]*)\.?([0-9]*)/; //handle Ex_   basically E1_ is same as E + 1 up to 15 then E16_=0x60 ~ 0x68
        }
        const matches = addressString.match(re);
        if(!matches || matches.length < 3) {
            throw new Error(`'${addressString}' is not a valid FINS address`);
        }

        const _decodeAddress = function(area,wd,bit) {
            let _area = area;
            let _wd = Number(wd);
            let _bit = bit;
            let _isBit = false;
            let _elementLength = 2;
            let _bytes = [];
            let _memAreaCode;
            if(_bit === 'x' || _bit === 'X') {
                _bit = '';
                if(_area == 'T' ||  _area == 'C') {
                    _isBit = true;
                    _elementLength = 1;
                } else {
                    throw new Error(`'${addressString}' is not a valid FINS address.  '.x' is only valid for accessing completion bit of C and T addresses`);
                }
            } else if (_bit && _bit.length) {
                _bit = parseInt(_bit);
                if(isNaN(_bit)) {
                    throw new Error(`'${addressString}' is not a valid FINS bit address`);
                }
                _elementLength = 1;
                _isBit = true;
            } else {
                _bit = '';
            }
            if(_area == 'IR') {
                _elementLength = 4;
            }
            const decodedMemory = {
                get MemoryArea() {
                    return _area;
                },
                get Address() {
                    return _wd;
                },
                get Bit() {
                    return _bit;
                },
                get isBitAddress() {
                    return _isBit;
                },
                get memoryAreaCode() {
                    return _memAreaCode;
                },
                get bytes() {
                    return _bytes;
                },
                get elementLength() {
                    return _elementLength;
                },
                toString: function(){
                    return addressToString(this, 0, 0)
                }
            };
            _memAreaCode = (_isBit ? self.memoryAreas.bit : self.memoryAreas.word)[_area]; //get INT value for desired Memory Area (e.g. D=0x82)
            if(_memAreaCode == null){
                throw new Error(`'${addressString}' is not a valid address for this CPU`);
            }
            _bytes = addressToBytes(decodedMemory);
            return decodedMemory;
        }
        const dm = _decodeAddress(matches[1], matches[2], matches[3]);
        return dm;
    }
    return {
        addressToBytes,
        stringToAddress,
        addressToString,
        get wordAreas() {
            return self.memoryAreas && self.memoryAreas.word;
        },
        get bitAreas() {
            return self.memoryAreas && self.memoryAreas.bit;
        },
        getPLCType() {
            return self.PLCType;
        }
    }
}

