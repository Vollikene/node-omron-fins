module.exports = SequenceManager;

/**
 * 
 * @param {Object} opts - options `minSID`, `maxSID`, `timeoutMS`
 * @param {Function} callback - a callback for errors and status
 * @returns 
 */
 function SequenceManager(opts, callback) {
    /** @type {SequenceManager}*/const self = this;

    function Statistics (sampleSize) {
        const self = this;
        this.sampleSize = sampleSize;
        this.size = sampleSize || 50;
        this.index = 0;
        this.replyCount = 0;
        this.minReplyMS = 0;
        this.maxReplyMS = 0;
        this.errorCount = 0;
        this.timeoutCount = 0;
        this.array = [];
        this.startTime = Date.now();
        this.mspTimer = null;
        this.mpsCounter = 0;
        this.mps = 0;
        _init();
        function _init() {
            self.index = 0;
            self.replyCount = 0;
            self.minReplyMS = 0;
            self.maxReplyMS = 0;
            self.errorCount = 0;
            self.timeoutCount = 0;
            self.mpsCounter = this.mps = 0;
            self.minReplyMS = Number.MAX_VALUE;
            self.array = new Array(self.sampleSize);
            for (let index = 0; index < self.sampleSize; index++) {
                self.array[index] = 0;
            }
            if (self.mspTimer) clearInterval(self.mspTimer);
            self.mspTimer = setInterval(function interval() {
                self.mps = self.mpsCounter;
                self.mpsCounter = 0;
            }, 1000);
        }
        function addReply (ms) {
            self.replyCount++;
            self.mpsCounter++;
            if (self.index >= self.array.length) self.index = 0;
            self.array[self.index++] = ms;
            if (ms > self.maxReplyMS) self.maxReplyMS = ms;
            if (ms < self.minReplyMS) self.minReplyMS = ms;
            return stats();
        }
        function addError () {
            self.errorCount++;
            return stats();
        }
        function addTimeout () {
            self.timeoutCount++;
            return stats();
        }
        function stats () {
            var _count = (self.replyCount > self.sampleSize ? self.sampleSize : self.replyCount) || 1;
            var sum = self.array.reduce(function (a, b) {
                return a + b;
            }, 0);
            var avg = (sum / _count) || 0;
            return {
                replyCount: self.replyCount,
                errorCount: self.errorCount,
                timeoutCount: self.timeoutCount,
                minReplyMS: self.minReplyMS,
                maxReplyMS: self.maxReplyMS,
                msgPerSec: self.mps,
                averageReplyMS: avg,
                runtimeMS: Date.now() - self.startTime
            };
        }
        function reset () {
            _init();
        }
        function close () {
            if (self.mspTimer) clearInterval(self.mspTimer);
        }
        return {
            addReply,
            addError,
            addTimeout,
            stats,
            reset,
            close
        };
    }

    this.statistics = new Statistics(50);
    //this.parent = parent;
    this.callback = callback;
    opts = opts || {};
    this.options = {
        minSID: opts.minSID || 1,
        maxSID: opts.maxSID || 254,
        timeoutMS: opts.timeoutMS || 10000
    };
    this.capacity = (this.options.maxSID - this.options.minSID) + 1;
    this.sequences = {};

    // function sequences () {
    //     return self.sequences;
    // }
    function freeSpace () {
        //future speed up - don't recalculate, instead, inc/dec an in-use counter
        return self.capacity - self.activeCount();
    }
    function activeCount () {
        //future speed up - don't recalculate, instead, inc/dec an in-use counter
        return Object.values(self.sequences).reduce(function (a, v) {
            return v && v.sid && !v.complete && !v.timeout && !v.error ? a + 1 : a;
        }, 0);
    }
    function add (SID, request, tag) {
        if (SID >= self.options.minSID && SID <= self.options.maxSID) {
            let seq = self.sequences[SID];
            if (seq && !seq.complete && !seq.timeout) {
                const e = Error("This SID is already waiting a reply");
                if (seq.request && seq.request.callback) {
                    seq.request.callback(e, seq);
                } else if (self.callback) {
                    self.callback(e, seq);
                } else {
                    throw e;
                }
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
            self.sequences[SID] = seq;
            const timeout = (request.options ? request.options.timeoutMS : null) || self.options.timeoutMS;
            seq.timer = setTimeout(function () {
                if (seq.complete || seq.error) return;
                seq.timeout = true;
                seq.stats = self.statistics.addTimeout();
                const e = new Error("timeout");
                if (seq.request && seq.request.callback) {
                    seq.request.callback(e, seq);
                } else if (self.callback) {
                    self.callback(e, seq);
                } else {
                    throw e;
                }
                // } else {
                //     self.parent.emit('timeout', parent.host, seq);
                // }
            }, timeout);
            return seq;
        }
        const e = Error("Invalid SID");
        if (request && request.callback) {
            request.callback(e, {request: request, tag: tag});
        } else if (self.callback) {
            self.callback(e, {request: request, tag: tag});
        } else {
            throw e;
        }
    }
    function get (SID) {
        if (SID >= self.options.minSID && SID <= self.options.maxSID) {
            return self.sequences[SID];
        }
    }
    function done (SID) {
        let seq = get(SID);
        if (seq) {
            seq.complete = true;
            seq.replyTime = Date.now();
            if (seq.timer) {
                clearTimeout(seq.timer);
                seq.timer = null;
                delete seq.timer;
            }
            seq.timeTaken = seq.replyTime - seq.createTime;
            seq.stats = self.statistics.addReply(seq.timeTaken);
        }
    }
    function setError (SID, err) {
        let seq = this.get(SID);
        if (seq) {
            seq.stats = self.statistics.addError();
            seq.error = err;
            if (seq.timer) {
                clearTimeout(seq.timer);
                seq.timer = null;
                delete seq.timer;
            }
            if (seq.request && seq.request.callback) {
                seq.request.callback(err, seq);
            } else if (self.callback) {
                self.callback(err, seq);
            }
            // } else {
            //     self.parent.emit('error', err, seq);
            // }
        }
    }
    function confirmSent (SID) {
        let seq = get(SID);
        if (seq) {
            seq.sentTime = Date.now();
            seq.sent = true;
        }
    }
    function remove (SID) {
        let seq = get(SID);
        if (seq) {
            if (seq.timer) {
                clearTimeout(seq.timer);
                seq.timer = null;
                delete seq.timer;
            }
            self.sequences[SID] = null; //TODO: consider object reuse!
            delete self.sequences[SID];
        }
    }
    function close () {
        self.statistics.close();
        for (let _SID = self.options.minSID; _SID < self.options.maxSID; _SID++) {
            try {
                remove(_SID);
            } catch (error) {
                //do nothing
            }
        }
    }
    return {
        freeSpace,
        activeCount,
        add,
        get,
        done,
        setError,
        confirmSent,
        remove,
        close
    };
}
