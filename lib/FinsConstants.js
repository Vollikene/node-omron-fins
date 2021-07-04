
module.exports.DefaultHostValues = {
    host : '127.0.0.1',
    port : 9600
};


module.exports.DefaultOptions = {
    timeout: 2000,
    max_queue: 50,
    protocol: "udp"
};


module.exports.DefaultFinsHeader = {
    ICF : 0x80,
    RSV : 0x00,
    GCT : 0x02,
    DNA : 0x00,
    DA1 : 0x00,
    DA2 : 0x00,
    SNA : 0x00,
    SA1 : 0x00,
    SA2 : 0x00,
    SID : 0x00
};

const CommandCodes = {
    /** Command 01 01 */
    MEMORY_AREA_READ       : [0x01,0x01],
    /** Command 01 02 */
    MEMORY_AREA_WRITE      : [0x01,0x02],
    /** Command 01 03 */
    MEMORY_AREA_FILL       : [0x01,0x03],
    /** Command 01 04 */
    MEMORY_AREA_READ_MULTI : [0x01,0x04],
    /** Command 01 05 */
    MEMORY_AREA_TRANSFER   : [0x01,0x05],
    /** Command 04 01 */
    RUN                    : [0x04,0x01],
    /** Command 04 02 */
    STOP                   : [0x04,0x02],
    /** Command 05 01 */
    CPU_UNIT_DATA_READ     : [0x05,0x01],
    /** Command 06 01 */
    CPU_UNIT_STATUS_READ   : [0x06,0x01],
    /** Command 07 01 */
    CLOCK_READ             : [0x07,0x01],
    /** Command 07 02 */
    CLOCK_WRITE            : [0x07,0x02],
};

const Commands = {
    "0101" : {
        name: "read",
        command: CommandCodes.MEMORY_AREA_READ,
        desc: "MEMORY AREA READ",
        descExtra: "Reads the contents of consecutive I/O memory area words",
        params: [
            { name: "address", type: "string", required: true},
            { name: "count", type: "number", required: true, min: 1},
        ]
    },
    "0102" : {
        name: "write",
        command: CommandCodes.MEMORY_AREA_WRITE,
        desc: "MEMORY AREA WRITE",
        descExtra: "Writes the contents of consecutive I/O memory area words",
        params: [
            { name: "address", type: "string", required: true},
            { name: "data", type: "number", required: true, min: 1},
        ]
    },
    "0103" : {
        name: "fill",
        command: CommandCodes.MEMORY_AREA_FILL,
        desc: "MEMORY AREA FILL",
        descExtra: "Writes the same data to the specified range of I/O memory area words",
        params: [
            { name: "address", type: "string", required: true},
            { name: "value", type: "number", required: true},
            { name: "count", type: "number", required: true, min: 1},
        ]
    },
    "0104" : {
        name: "read-multiple",
        command: CommandCodes.MEMORY_AREA_READ_MULTI,
        desc: "MULTIPLE MEMORY AREA READ",
        descExtra: "Writes the same data to the specified range of I/O memory area words",
        params: [
            { name: "address", type: "string", required: true},
            { name: "value", type: "number", required: true},
            { name: "count", type: "number", required: true, min: 1},
        ]
    },
    "0105" : {
        name: "transfer",
        command: CommandCodes.MEMORY_AREA_TRANSFER,
        desc: "MEMORY AREA TRANSFER",
        descExtra: "Copies the contents of consecutive I/O memory area words to another I/O memory area",
        params: [
            { name: "srcAddress", type: "string", required: true},
            { name: "dstAddress", type: "string", required: true},
            { name: "count", type: "number", required: true, min: 1},
        ]
    },
    "0401" : {
        name: "run",
        command: CommandCodes.RUN,
        desc: "SET PLC MODE RUN",
        descExtra: "Changes the CPU Unit’s operating mode to RUN or MONITOR",
    },
    "0402" : {
        name: "stop",
        command: CommandCodes.STOP,
        desc: "SET PLC MODE STOP",
        descExtra: "Changes the CPU Unit’s operating mode to PROGRAM",
    },
    "0501" : {
        name: "cpu-unit-data-read",
        command: CommandCodes.CPU_UNIT_DATA_READ,
        desc: "CPU UNIT DATA READ",
        descExtra: "Reads CPU Unit data",
    },
    "0601" : {
        name: "status",
        command: CommandCodes.CPU_UNIT_STATUS_READ,
        desc: "CPU UNIT STATUS READ",
        descExtra: "Reads the status of the CPU Unit",
    },
    "0701" : {
        name: "clock-read",
        command: CommandCodes.CLOCK_READ,
        desc: "CLOCK READ",
        descExtra: "Reads the present year, month, date, minute, second, and day of the week",
    },
    "0702" : {
        name: "clock-write",
        command: CommandCodes.CLOCK_WRITE,
        desc: "CLOCK WRITE",
        descExtra: "Changes the present year, month, date, minute, second, or day of the week",
        params: [
            { name: "clockData", type: "object", required: true},
        ]
    },
}

const commandKeys = Object.keys(Commands);
for (let index = 0; index < commandKeys.length; index++) {
    const commandKey = commandKeys[index];
    const command = Commands[commandKey];
    command.commandCode = commandKey;
    Commands[Commands[commandKey].name] = command;
}

module.exports.CommandCodes = CommandCodes;
module.exports.Commands = Commands;



const CSCJ_MODE_BIT_MemoryAreas = {
    "E0"  : 0x20,//Extended Memories
    "E1"  : 0x21,//Extended Memories
    "E2"  : 0x22,//Extended Memories
    "E3"  : 0x23,//Extended Memories
    "E4"  : 0x24,//Extended Memories
    "E5"  : 0x25,//Extended Memories
    "E6"  : 0x26,//Extended Memories
    "E7"  : 0x27,//Extended Memories
    "E8"  : 0x28,//Extended Memories
    "E9"  : 0x29,//Extended Memories
    "EA"  : 0x2A,//Extended Memories
    "EB"  : 0x2B,//Extended Memories
    "EC"  : 0x2C,//Extended Memories
    "EE"  : 0x2D,//Extended Memories
    "EF"  : 0x2E,//Extended Memories
    "E10" : 0x60,//Extended Memories
    "E11" : 0xE1,//Extended Memories
    "E12" : 0xE2,//Extended Memories
    "E13" : 0xE3,//Extended Memories
    "E14" : 0xE4,//Extended Memories
    "E15" : 0xE5,//Extended Memories
    "E16" : 0xE6,//Extended Memories
    "E17" : 0xE7,//Extended Memories
    "E18" : 0xE8,//Extended Memories
    "EM"  : 0x0A,//Extended Memories
    "T"   : 0x09,//TIM BIT
    "C"   : 0x09,//CNT BIT
    "CIO" : 0x30,//CIO
    "W"   : 0x31,//Work Area
    "H"   : 0x32,//Holding Bit
    "A"   : 0x33,//Auxiliary Bit
    "D"   : 0x02,//Data Memories
    /**
     * Calculates the correct FINS memory "Beginning Address" for given area and address
     * @param {String} memoryArea - e.g "D" or "CIO"
     * @param {Number} memoryAddress - The start word address
     * @returns FINS memory "Beginning Address"
     */
    CalculateMemoryAreaAddress : function(memoryArea, memoryAddress) {
        switch (memoryArea) {
        case "C":
            return memoryAddress+ 0x8000;
        default:
            return memoryAddress;
        }
    }
};


const CSCJ_MODE_WD_MemoryAreas = {
    "E0"  : 0xA0,//Extended Memories
    "E1"  : 0xA1,//Extended Memories
    "E2"  : 0xA2,//Extended Memories
    "E3"  : 0xA3,//Extended Memories
    "E4"  : 0xA4,//Extended Memories
    "E5"  : 0xA5,//Extended Memories
    "E6"  : 0xA6,//Extended Memories
    "E7"  : 0xA7,//Extended Memories
    "E8"  : 0xA8,//Extended Memories
    "E9"  : 0xA9,//Extended Memories
    "EA"  : 0xAA,//Extended Memories
    "EB"  : 0xAB,//Extended Memories
    "EC"  : 0xAC,//Extended Memories
    "EE"  : 0xAD,//Extended Memories
    "EF"  : 0xAE,//Extended Memories
    "E10" : 0x60,//Extended Memories
    "E11" : 0x61,//Extended Memories
    "E12" : 0x62,//Extended Memories
    "E13" : 0x63,//Extended Memories
    "E14" : 0x64,//Extended Memories
    "E15" : 0x65,//Extended Memories
    "E16" : 0x66,//Extended Memories
    "E17" : 0x67,//Extended Memories
    "E18" : 0x68,//Extended Memories
    "EM"  : 0x98,//Extended Memories
    "T"   : 0x89,//TIM PV
    "C"   : 0x89,//CNT PV
    "CIO" : 0xB0,//CIO
    "W"   : 0xB1,//Work Area
    "H"   : 0xB2,//Holding Bit
    "A"   : 0xB3,//Auxiliary Bit
    "D"   : 0x82,//Data Memories
    "IR"  : 0xDC,//Index Registers PV
    "DR"  : 0xBC,//Data Registers PV
    /**
     * Calculates the correct FINS memory "Beginning Address" for given area and address
     * @param {String} memoryArea - e.g "D" or "CIO"
     * @param {Number} memoryAddress - The start word address
     * @returns FINS memory "Beginning Address"
     */
    CalculateMemoryAreaAddress : function(memoryArea, memoryAddress ) {
        switch (memoryArea) {
        case "C":
            return memoryAddress + 0x8000;
        case "IR":
            return memoryAddress + 0x0100;
        case "DR":
            return memoryAddress + 0x0200;
        default:
            return memoryAddress;
        }
    }
};



const CV_MODE_BIT_MemoryAreas = {
    'T'   : 0x01,//TIM Bit
    'C'   : 0x01,//CNT Bit 
    'CIO' : 0x00,//CIO Bit
    'A'   : 0x00,//Auxiliary Bit
    /**
     * Calculates the correct FINS memory "Beginning Address" for given area and address
     * @param {String} memoryArea - e.g "D" or "CIO"
     * @param {Number} memoryAddress - The start word address
     * @returns FINS memory "Beginning Address"
     */
    CalculateMemoryAreaAddress : function(memoryArea, memoryAddress ) {
        switch (memoryArea) {
        case "C":
            return memoryAddress + 0x0800;
        case "A":
            return memoryAddress + 0x0B00;
        default:
            return memoryAddress;
        }
    }
};

const CV_MODE_WD_MemoryAreas = {
    'E0'  : 0x90,//Extended Memories
    'E1'  : 0x91,//Extended Memories
    'E2'  : 0x92,//Extended Memories
    'E3'  : 0x93,//Extended Memories
    'E4'  : 0x94,//Extended Memories
    'E5'  : 0x95,//Extended Memories
    'E6'  : 0x96,//Extended Memories
    'E7'  : 0x97,//Extended Memories
    "EM"  : 0x98,//Extended Memories
    'T'   : 0x81,//TIM PV
    'C'   : 0x81,//CNT PV 
    'CIO' : 0x80,//CIO
    'A'   : 0x80,//Auxiliary Bit
    'D'   : 0x82,//Data Memories
    'DR'  : 0x9C,//Data Registers
    /**
     * Calculates the correct FINS memory "Beginning Address" for given area and address
     * @param {String} memoryArea - e.g "D" or "CIO"
     * @param {Number} memoryAddress - The start word address
     * @returns FINS memory "Beginning Address"
     */
    CalculateMemoryAreaAddress : function(memoryArea, memoryAddress ) {
        switch (memoryArea) {
        case "C":
            return memoryAddress + 0x0800;
        case "A":
            return memoryAddress + 0x0B00;    
        case "DR":
            return memoryAddress + 0x0003;
        default:
            return memoryAddress;
        }
    }
};

const MemoryAreas = {
    CV: {
        bit: CV_MODE_BIT_MemoryAreas,
        word: CV_MODE_WD_MemoryAreas,
    },
    CS: {
        bit: CSCJ_MODE_BIT_MemoryAreas,
        word: CSCJ_MODE_WD_MemoryAreas,
    }
};
MemoryAreas.CP = MemoryAreas.CS;
MemoryAreas.CJ = MemoryAreas.CS;
MemoryAreas.NX = MemoryAreas.CS;
MemoryAreas.CSCJ = MemoryAreas.CS;
MemoryAreas.NJNX = MemoryAreas.CS;

module.exports.MemoryAreas = MemoryAreas;


//TODO: create CS/CJ/NJ/NX specific bit map
//SEE CS - https://www.myomron.com/downloads/1.Manuals/Networks/W227E12_FINS_Commands_Reference_Manual.pdf Sec 2-21
//SEE CJ - https://www.support-omron.fr/telechargements/documentations/2019-01-18%20-%2014-40-23%20-%20616945746/FINS%20Command%20from%20W342-E1-16.pdf
module.exports.FatalErrorData = {
    WATCHDOG_ERROR    : 1 << 0,
    SYSTEM_ERROR      : 1 << 6,
    CYCLE_TIME_OVER   : 1 << 8,
    PROGRAM_ERROR     : 1 << 9,
    IO_SETTING_ERROR  : 1 << 10,
    IO_POINT_OVERFLOW : 1 << 11,
    INNER_BOARD_ERROR : 1 << 12,
    DUPLICATION_ERROR : 1 << 13,
    IO_BUS_ERROR      : 1 << 14,
    MEMORY_ERROR      : 1 << 15
};
//TODO: create CS/CJ/NJ/NX specific bit map
module.exports.NonFatalErrorData = {
    PC_LINK_ERROR         : 1 << 0,
    HOST_LINK_ERROR       : 1 << 1,
    BATTERY_ERROR         : 1 << 4,
    SYSMAC_BUS_ERROR      : 1 << 5,
    SPECIAL_IO_UNIT_ERROR : 1 << 6,
    CPU_BUS_UNIT_ERROR    : 1 << 7,
    INNER_BOARD_ERROR     : 1 << 8,
    IO_VERIFICATION_ERROR : 1 << 9,
    PLC_SETUP_ERROR       : 1 << 10,
    BASIC_IO_UNIT_ERROR   : 1 << 12,
    INTERRUPT_TASK_ERROR  : 1 << 13,
    DUPLEX_ERROR          : 1 << 14,
    SYSTEM_ERROR          : 1 << 15
};

module.exports.Status = {
    CPU_STANDBY : 0x80,
    STOP        : 0x00,
    RUN         : 0x01
};

//TODO: create CS/CJ/NJ/NX specific bit map
module.exports.Modes = {
    MONITOR : 0x02,
    PROGRAM : 0x00,
    DEBUG   : 0x01,
    RUN     : 0x04
};


module.exports.TCPCommandErrorCodes = {
    "0": "Normal",
    "1": "The header is not ‘FINS’ (ASCII code).",
    "2": "The data length is too long.",
    "3": "The command is not supported.",
    "20": "All connections are in use.",
    "21": "The specified node is already connected.",
    "22": "Attempt to access a protected node from an unspecified IP address.",
    "23": "The client FINS node address is out of range.",
    "24": "The same FINS node address is being used by the client and server.",
    "25": "All the node addresses available for allocation have been used",
}

module.exports.EndCodeDescriptions = {
    "0000" : "Normal Completion.",
    "0001" : "Service Cancelled.",
    "0101" : "Local Error: Local node not in network.",
    "0102" : "Local Error: Token Timeout.",
    "0103" : "Local Error: Retries Failed.",
    "0104" : "Local Error: Too many send frames.",
    "0105" : "Local Error: Node address range error.",
    "0106" : "Local Error: Node Address Duplication.",
    "0201" : "Destination Node Error: Destination Node not in network.",
    "0202" : "Destination Node Error: Unit Missing.",
    "0203" : "Destination Node Error: Third Node missing.",
    "0204" : "Destination Node Error: Destination Node busy.",
    "0205" : "Destination Node Error: Response Timeout.",
    "0301" : "Controller Error: Communications Controller Error.",
    "0302" : "Controller Error: CPU Unit Error.",
    "0303" : "Controller Error: Controller Error.",
    "0304" : "Controller Error: Unit number Error.",
    "0401" : "Service Unsupported: Undefined Command.",
    "0402" : "Service Unsupported: Not supported by Model/Version.",
    "0501" : "Routing Table Error: Destination address setting error.",
    "0502" : "Routing Table Error: No routing tables.",
    "0503" : "Routing Table Error: Routing table error.",
    "0504" : "Routing Table Error: Too many delays.",
    "1001" : "Command Format Error: Command too long.",
    "1002" : "Command Format Error: Command too short.",
    "1003" : "Command Format Error: Elements/Data don't match.",
    "1004" : "Command Format Error: Command format error.",
    "1005" : "Command Format Error: Header Error.",
    "1101" : "Parameter Error: Area classification missing.",
    "1102" : "Parameter Error: Access Size Error.",
    "1103" : "Parameter Error: Address range error.",
    "1104" : "Parameter Error: Address range exceeded.",
    "1106" : "Parameter Error: Program Missing.",
    "1109" : "Parameter Error: Relational Error.",
    "110A" : "Parameter Error: Duplicate Data Access.",
    "110B" : "Parameter Error: Response too long.",
    "110C" : "Parameter Error: Parameter Error.",
    "2002" : "Read Not Possible: Protected.",
    "2003" : "Read Not Possible: Table missing.",
    "2004" : "Read Not Possible: Data missing.",
    "2005" : "Read Not Possible: Program missing.",
    "2006" : "Read Not Possible: File missing.",
    "2007" : "Read Not Possible: Data mismatch.",
    "2101" : "Write Not Possible: Read Only.",
    "2102" : "Write Not Possible: Protected - cannot write data link table.",
    "2103" : "Write Not Possible: Cannot register.",
    "2105" : "Write Not Possible: Program missing.",
    "2106" : "Write Not Possible: File missing.",
    "2107" : "Write Not Possible: File name already exists.",
    "2108" : "Write Not Possible: Cannot change.",
    "2201" : "Not executable in current mode: Not possible during execution.",
    "2202" : "Not executable in current mode: Not possible while running.",
    "2203" : "Not executable in current mode: Wrong PLC mode (Program).",
    "2204" : "Not executable in current mode:  Wrong PLC mode (Debug).",
    "2205" : "Not executable in current mode: Wrong PLC mode (Monitor).",
    "2206" : "Not executable in current mode: Wrong PLC mode (Run).",
    "2207" : "Not executable in current mode: Specified node not polling node.",
    "2208" : "Not executable in current mode: Step cannot be executed.",
    "2301" : "No such device: File device missing.",
    "2302" : "No such device: Missing memory.",
    "2303" : "No such device: Clock missing.",
    "2401" : "Cannot Start/Stop: Table missing.",
    "2502" : "Unit Error: Memory Error.",
    "2503" : "Unit Error: I/O setting Error.",
    "2504" : "Unit Error: Too many I/O points.",
    "2505" : "Unit Error: CPU bus error.",
    "2506" : "Unit Error: I/O Duplication.",
    "2507" : "Unit Error: I/O bus error.",
    "2509" : "Unit Error: SYSMAC BUS/2 error.",
    "250A" : "Unit Error: CPU Bus Unit Error.",
    "250D" : "Unit Error: SYSMAC BUS No. duplication.",
    "250F" : "Unit Error: Memory Error.",
    "2510" : "Unit Error: SYSMAC BUS terminator missing.",
    "2601" : "Command Error: No protection.",
    "2602" : "Command Error: Incorrect password.",
    "2604" : "Command Error: Protected.",
    "2605" : "Command Error: Service already executing.",
    "2606" : "Command Error: Service stopped.",
    "2607" : "Command Error: No execution right.",
    "2608" : "Command Error: Settings not complete.",
    "2609" : "Command Error: Necessary items not set.",
    "260A" : "Command Error: Number already defined.",
    "260B" : "Command Error: Error will not clear.",
    "3001" : "Access Right Error: No access right.",
    "4001" : "Abort: Service aborted.",
}