/*
interface CreepState {
    state: "available" | "busy";
}

export class CollectResourceTask extends TaskBase {
    private readonly scheduledCreeps = new Map<Id<Creep>, CreepState>();
    public constructor(private _objectScheduler: ObjectScheduler) {
        super();
    }
    public async doWork(cancellationToken: ICancellationToken): Promise<void> {
        while (true) {
            await nextGameFrame();
            cancellationToken.throwIfCancellationRequested();
            for (const [c] of this.scheduledCreeps) {
                if (!Game.getObjectById(c)) this.scheduledCreeps.delete(c);
            }
            const scheduled = await this._objectScheduler.scheduleCreep({
                sku: "CarryWorker",
                priority: 0,
                resource: "free"
            });
            if (scheduled) {
                const state: CreepState = { state: "available" };
                this.scheduledCreeps.set(scheduled.creepRef.id, state);
                this.creepTask(scheduled, state, cancellationToken);
            }
        }
    }
    private async creepTask(scheduledCreep: ScheduledCreep, creepState: CreepState, ct: ICancellationToken): Promise<void> {
        try {
            while (true) {
                creepState.state = "available";
                const res = await this._objectScheduler.scheduleSource({resource: })
                await creepCollectAction({
                    creepRef: scheduledCreep.creepRef,
                    sourceRef: this.controllerRef,
                    resourceType: "any",
                }, ct);
            }
        } finally {
            scheduledCreep.dispose();
            this.scheduledCreeps.delete(scheduledCreep.creepRef.id);
        }
    }
}
*/