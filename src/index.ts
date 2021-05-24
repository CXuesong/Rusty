export function loop() {
    console.log("Rusty primary loop: Started.")
    try {

    } catch (err) {
        console.error("Rusty primary loop: Error.", err);
    } finally {
        console.log("Rusty primary loop: Finished.")
    }
}