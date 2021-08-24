import { Logger } from "src/utility/logger";
import { CancellationTokenSource, ICancellationToken, IDisposable } from "tasklike-promise-library";

export interface TaskType {
    new(...args: any[]): TaskBase;
}

export abstract class TaskBase implements IDisposable {
    private _disposalCts = new CancellationTokenSource;
    protected abstract readonly logger: Logger;
    public readonly disposal: ICancellationToken = this._disposalCts.token;
    public async start(): Promise<void> {
        try {
            await this.doWork(this.disposal);
        } catch (err) {
            this.logger.error("Uncaught error in doWork.", err);
        } finally {
            this.dispose();
        }
    }
    protected abstract doWork(cancellationToken: ICancellationToken): PromiseLike<void>;
    public get isCompleted(): boolean {
        return this._disposalCts.isCancellationRequested;
    }
    public dispose() {
        this._disposalCts.cancel();
    }
}
