declare interface Array<T> {
    remove(item: T): boolean;
    remove(item: unknown): boolean;
    removeAll(predicate: (item: T, index: number, obj: T[]) => unknown): number;
}

(() => {
    Array.prototype.remove = function remove(item: any): boolean {
        const index = this.indexOf(item);
        if (index >= 0) {
            this.splice(index, 1);
            return true;
        }
        return false;
    };

    Array.prototype.removeAll = function removeAll(predicate: (item: any, index: number, obj: any[]) => unknown): number {
        let index;
        let count = 0;
        while ((index = this.findIndex(predicate)) >= 0) {
            this.splice(index, 1);
            count++;
        }
        return count;
    };

    if (typeof console.assert !== "function") {
        console.assert = function assert(condition?: boolean, ...rest: any[]): void {
            if (!condition) {
                const err = new Error("Assertion failure. " + rest.join(" "));
                console.log(String((err as Error).stack || err));
            }
        }
    }

    if (typeof console.trace !== "function") {
        console.trace = function trace(...rest: any[]): void {
            const err = new Error(rest.join(" "));
            err.name = "";
            console.log(String((err as Error).stack || err));
        }
    }

    if (typeof console.warn !== "function")
        console.warn = console.log;

    if (typeof console.error !== "function")
        console.error = console.trace;
})();