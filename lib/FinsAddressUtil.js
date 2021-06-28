const constants = require('./constants');
const {wordsToBytes, isInt} = require('./data_utilities');


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
            self.memoryAreas = constants.MemoryAreas.CS;
            break;
        case "CJ":
            self.memoryAreas = constants.MemoryAreas.CS;
            break;
        case "NJ":
        case "NJNX":
            self.memoryAreas = constants.MemoryAreas.CS;
            break;
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
            offsetBit = isInt(offsetBit, 0);
            return `${decodedMemoryAddress.MemoryArea}${parseInt(decodedMemoryAddress.Address) + offsetWD}.${decodedMemoryAddress.Bit + offsetBit}`;
        }
        return `${decodedMemoryAddress.MemoryArea}${parseInt(decodedMemoryAddress.Address) + offsetWD}`;
    }
    
    function stringToAddress(addressString) {
        var re = /([A-Z]*)([0-9]*)\.?([0-9]*)/;//normal address Dxxx Cxxx    
        if (addressString.includes("_"))
            re = /(.+)_([0-9]*)\.?([0-9]*)/; //handle Ex_   basically E1_ is same as E + 1 up to 15 then E16_=0x60 ~ 0x68
        var matches = addressString.match(re);

        var decodedMemory = {
            'MemoryArea': matches[1],
            'Address': Number(matches[2]),
            'Bit': matches[3],
            get isBitAddress() {
                return typeof this.Bit == "number";
            },
            get memoryAreaCode() {
                const memAreas =  this.isBitAddress ? self.memoryAreas.bit : self.memoryAreas.word;
                const memAreaCode = memAreas[this.MemoryArea]; //get INT value for desired Memory Area (e.g. D=0x82)
                return memAreaCode;
            },
            get bytes() {
                return addressToBytes(this);
            }
        };

        if (decodedMemory.Bit && decodedMemory.Bit.length) {
            decodedMemory.Bit = parseInt(decodedMemory.Bit);
        }
        return decodedMemory;
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

