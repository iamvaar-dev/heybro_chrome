
export const Logger = {
    logs: [],
    limit: 1000,
    listeners: [],

    log(type, data) {
        const entry = {
            id: Date.now() + Math.random().toString(36).slice(2),
            timestamp: Date.now(),
            type,
            data: typeof data === 'object' ? JSON.parse(JSON.stringify(data)) : data
        };

        this.logs.push(entry);
        if (this.logs.length > this.limit) {
            this.logs.shift();
        }

        // Dispatch to listeners
        this.listeners.forEach(cb => cb(entry));

        // Dispatch event for UI
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('heybro-log', { detail: entry }));
        }

        // Also log to console for debugging
        console.log(`[${type.toUpperCase()}]`, data);
    },

    info(data) { this.log('info', data); },
    warn(data) { this.log('warn', data); },
    error(data) { this.log('error', data); },
    debug(data) { this.log('debug', data); },

    getLogs() {
        return [...this.logs];
    },

    clear() {
        this.logs = [];
        this.log('info', 'Logs cleared');
    },

    subscribe(callback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }
};
