import { machineCredit } from "./config/blockchain.js";

async function main() {
  const count = await machineCredit.machineCount();

  console.log("Machine count:", count.toString());

  if (count > 0n) {
    const machine = await machineCredit.getMachine(1);

    console.log("Machine #1:");
    console.log(machine);
  }
}

main().catch((error) => {
  console.error("ERROR:", error);
  process.exit(1);
});