declare interface Array<T> {
    remove(item: T): boolean;
    remove(item: unknown): boolean;
}

Array.prototype.remove = function remove(item: any): boolean {
    const index = this.indexOf(item);
    if (index >= 0) {
        this.splice(index, 1);
        return true;
    }
    return false;
};
