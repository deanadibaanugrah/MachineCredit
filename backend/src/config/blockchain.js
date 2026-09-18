import "dotenv/config";
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

const machineCreditAbi = [
  // Machine
  "function machineCount() view returns (uint256)",
  "function getMachine(uint256) view returns (string,string,uint256,uint256,uint256,uint256,uint256,address,bool)",
  "function registerMachine(string,string,uint256,uint256,uint256,uint256)",

  // Investment
  "function invest(uint256,uint256)",
  "function getInvestor(uint256,address) view returns (uint256,uint256,bool)",
  "function getPendingRevenue(uint256,address) view returns (uint256)",
  "function claimRevenue(uint256)",

  // Revenue
  "function depositRevenue(uint256,uint256)",

  // Balance
  "function getUSDTBalance() view returns (uint256)",

  // Events
  "event InvestmentMade(uint256 indexed machineId,address indexed lender,uint256 amount)",
  "event RevenueDeposited(uint256 indexed machineId,uint256 revenue,uint256 lenderPool,uint256 companyShare)",
  "event RevenueClaimed(uint256 indexed machineId,address indexed lender,uint256 amount)"
];

const usdtAbi = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)"
];

export const machineCredit = new ethers.Contract(
  process.env.MACHINECREDIT_ADDRESS,
  machineCreditAbi,
  provider
);

export const usdt = new ethers.Contract(
  process.env.USDT_ADDRESS,
  usdtAbi,
  provider
);

export { provider };