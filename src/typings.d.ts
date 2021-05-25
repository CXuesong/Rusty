
interface Memory {
    rusty: unknown;
}

interface CreepMemory {
    rusty: unknown;
    rustyType: string;
}

declare module "wu/wu.js" {
    import { WuIterable } from "wu";
    export default WuIterable
}
