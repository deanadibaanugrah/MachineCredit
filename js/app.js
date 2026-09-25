const SUPABASE_URL = "https://mdacupwxmqfcqertftzu.supabase.co";

const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ZrQNBGX5mlBZVHMN06i8hA_FrWB2r1D";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

console.log("Supabase client:", supabaseClient);

// const API_BASE_URL = "http://localhost:5000/api";

const API_BASE_URL = "https://incredible-victory-production-c40b.up.railway.app/api";

/* =========================================================
   NETWORK CONFIG
   Ganti ACTIVE_NETWORK untuk pindah testnet <-> mainnet.
   Pastikan env backend di Railway juga ikut diganti.
   ========================================================= */

const NETWORKS = {

  testnet: {
    chainName: "BOT Chain Testnet",
    chainId: 968,
    rpcUrl: "https://rpc.bohr.life",
    explorerUrl: "https://scan.bohr.life",
    machineCreditAddress: "0xe669BC1281F59ad94E36e850736E5B0075C16e39",
    usdtAddress: "0x75edC9335175Fc0552D51D48439F229c10420fe3"
  },

  mainnet: {
    chainName: "BOT Chain Mainnet",
    chainId: 677,
    rpcUrl: "https://rpc.botchain.ai",
    explorerUrl: "https://scan.botchain.ai",
    machineCreditAddress: "0x14f9b029Ab79307B8119163E8EFc51D68919E7c1",
    usdtAddress: "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C"
  }

};

const ACTIVE_NETWORK = "mainnet";

const NETWORK = NETWORKS[ACTIVE_NETWORK];

if (!NETWORK.machineCreditAddress) {
  console.error(
    `MachineCredit address for ${NETWORK.chainName} is not set`
  );
}

const MACHINECREDIT_ADDRESS = NETWORK.machineCreditAddress;
const USDT_ADDRESS = NETWORK.usdtAddress;

const BOT_CHAIN_ID = NETWORK.chainId;
const BOT_CHAIN_HEX = `0x${NETWORK.chainId.toString(16)}`;
const EXPLORER_URL = NETWORK.explorerUrl;
const BOT_RPC_URL = NETWORK.rpcUrl;

const readOnlyProvider =
  new ethers.JsonRpcProvider(BOT_RPC_URL);

/* =========================================================
   CONTRACT ABI
   ========================================================= */

const MACHINECREDIT_ABI = [
  "function machineCount() view returns (uint256)",

  "function getMachine(uint256) view returns (string,string,uint256,uint256,uint256,uint256,uint256,address,bool)",

  "function registerMachine(string,string,uint256,uint256,uint256,uint256)",

  "function invest(uint256,uint256)",

  "function getInvestor(uint256,address) view returns (uint256,uint256,bool)",

  "function getPendingRevenue(uint256,address) view returns (uint256)",

  "function claimRevenue(uint256)",

  "function depositRevenue(uint256,uint256)",

  "function withdrawFunding(uint256)",

  "function repayPrincipal(uint256,uint256)",

  "function claimPrincipal(uint256)",

  "function getFinancing(uint256) view returns (uint256,uint256,uint256,uint256,uint256,uint8)",

  "function getPrincipalEntitlement(uint256,address) view returns (uint256)",

  "function getClaimablePrincipal(uint256,address) view returns (uint256)",

  "function getUSDTBalance() view returns (uint256)",

  "event MachineRegistered(uint256 indexed machineId,string externalMachineId,string name,address indexed owner,uint256 fundingTarget,uint256 revenueSharePercent)",

  "event InvestmentMade(uint256 indexed machineId,address indexed lender,uint256 amount)", 

  "event RevenueDeposited(uint256 indexed machineId,uint256 revenue,uint256 lenderPool,uint256 companyShare)",

  "event RevenueClaimed(uint256 indexed machineId,address indexed lender,uint256 amount)",

  "event FundingWithdrawn(uint256 indexed machineId,address indexed owner,uint256 amount)",

  "event PrincipalRepaid(uint256 indexed machineId,uint256 amount,uint256 principalLoss,uint8 status)",

  "event PrincipalClaimed(uint256 indexed machineId,address indexed lender,uint256 amount)"
];

const FINANCING_STATUS_LABEL = ["Open", "Completed", "Defaulted"];

const USDT_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)"
];

/* =========================================================
   APP STATE
   ========================================================= */

let currentFilter = "all";

let currentMachineId = null;

let connected = false;

let walletAddress = null;

let provider = null;

let signer = null;

let userRole = null;

let blockchainMachines = [];

let notifications = [];

let currentSettlementMachineId = null;

let eventsContract = null;

let selectedMachineImageFile = null;

function getSyncBlockKey(address) {

  return `machinecredit_lastblock_${BOT_CHAIN_ID}_${String(address).toLowerCase()}`;

}


function getProcessedEventsKey(address) {

  return `machinecredit_processed_${BOT_CHAIN_ID}_${String(address).toLowerCase()}`;

}


function getProcessedEvents(address) {

  try {

    const raw =
      localStorage.getItem(
        getProcessedEventsKey(address)
      );

    return raw ? JSON.parse(raw) : [];

  } catch {

    return [];

  }

}


function markEventProcessed(address, eventKey) {

  const processed =
    getProcessedEvents(address);

  processed.push(eventKey);

  localStorage.setItem(
    getProcessedEventsKey(address),
    JSON.stringify(
      processed.slice(-200)
    )
  );

}

/* =========================================================
   UTILITY
   ========================================================= */

function escapeHTML(value) {

  return String(value ?? "").replace(
    /[&<>"']/g,
    char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char])
  );

}


function setText(id, value) {

  const element =
    document.getElementById(id);

  if (element) {
    element.textContent = value;
  }

}


function showToast(message) {

  const toast =
    document.getElementById("toast");

  if (!toast) {
    return;
  }

  toast.textContent = message;

  toast.classList.add("show");

  clearTimeout(window.__toastTimer);

  window.__toastTimer =
    setTimeout(() => {
      toast.classList.remove("show");
    }, 2800);

}


function showTransactionToast(message, txHash) {

  const toast =
    document.getElementById("toast");

  if (!toast) {
    return;
  }

  toast.innerHTML = `
    <span>
      ${escapeHTML(message)}
    </span>

    <a
      href="${EXPLORER_URL}/tx/${txHash}"
      target="_blank"
      rel="noopener noreferrer"
      style="
        margin-left:10px;
        color:#7db0ff;
        font-weight:700;
        text-decoration:none;
      "
    >
      View transaction ↗
    </a>
  `;

  toast.classList.add("show");

  clearTimeout(window.__toastTimer);

  window.__toastTimer =
    setTimeout(() => {
      toast.classList.remove("show");
    }, 5000);

}


function showComingSoonModal() {
  document.getElementById("comingSoonModal")?.classList.add("active");
}

function hideComingSoonModal() {
  document.getElementById("comingSoonModal")?.classList.remove("active");
}

function formatUSDT(value) {

  try {

    return Number(
      ethers.formatUnits(
        String(value ?? 0),
        6
      )
    ).toLocaleString(
      undefined,
      {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      }
    );

  } catch {

    return "0";

  }

}

/* =========================================================
   RECENT ACTIVITY FEED (onchain)
   ========================================================= */

function shortAddress(address) {

  return `${address.slice(0, 6)}...${address.slice(-4)}`;

}

function formatRelativeTime(timestampSeconds) {

  const diff =
    Math.floor(Date.now() / 1000) - timestampSeconds;

  if (diff < 60) {
    return "just now";
  }

  if (diff < 3600) {
    return `${Math.floor(diff / 60)} min ago`;
  }

  if (diff < 86400) {
    return `${Math.floor(diff / 3600)} hr ago`;
  }

  return `${Math.floor(diff / 86400)} day${
    Math.floor(diff / 86400) === 1 ? "" : "s"
  } ago`;

}

function findMachineLabel(machineIdOnchain) {

  const machine =
    blockchainMachines.find(
      m => Number(m.id) === Number(machineIdOnchain)
    );

  return machine
    ? machine.machineId
    : `Machine #${machineIdOnchain}`;

}

async function loadRecentActivity() {

  const feed =
    document.getElementById("activityFeed");

  if (!feed) {
    return;
  }

  try {

    const readContract =
      new ethers.Contract(
        MACHINECREDIT_ADDRESS,
        MACHINECREDIT_ABI,
        readOnlyProvider
      );

    const latestBlock =
      await readOnlyProvider.getBlockNumber();

    const fromBlock =
      Math.max(latestBlock - 5000, 0);

    const [
      registeredLogs,
      investmentLogs,
      revenueLogs,
      claimLogs
    ] = await Promise.all([

      readContract.queryFilter(
        readContract.filters.MachineRegistered(),
        fromBlock,
        latestBlock
      ),

      readContract.queryFilter(
        readContract.filters.InvestmentMade(),
        fromBlock,
        latestBlock
      ),

      readContract.queryFilter(
        readContract.filters.RevenueDeposited(),
        fromBlock,
        latestBlock
      ),

      readContract.queryFilter(
        readContract.filters.RevenueClaimed(),
        fromBlock,
        latestBlock
      )

    ]);

    const allLogs = [
      ...registeredLogs.map(log => ({ log, type: "registered" })),
      ...investmentLogs.map(log => ({ log, type: "invested" })),
      ...revenueLogs.map(log => ({ log, type: "deposited" })),
      ...claimLogs.map(log => ({ log, type: "claimed" }))
    ];

    allLogs.sort((a, b) => {

      if (b.log.blockNumber !== a.log.blockNumber) {
        return b.log.blockNumber - a.log.blockNumber;
      }

      return b.log.index - a.log.index;

    });

    const topLogs =
      allLogs.slice(0, 6);

    if (!topLogs.length) {

      feed.innerHTML = `
        <div class="activity-row">
          <div class="activity-main">
            <strong>No activity yet</strong>
            <span>Onchain events will appear here</span>
          </div>
        </div>
      `;

      return;

    }

    const blockNumbers =
      [...new Set(topLogs.map(item => item.log.blockNumber))];

    const blocks =
      await Promise.all(
        blockNumbers.map(bn => readOnlyProvider.getBlock(bn))
      );

    const blockTimeMap = {};

    blockNumbers.forEach((bn, index) => {
      blockTimeMap[bn] = blocks[index]?.timestamp || 0;
    });

    feed.innerHTML =
      topLogs
        .map(item => {

          const timeLabel =
            formatRelativeTime(
              blockTimeMap[item.log.blockNumber] || 0
            );

          const args = item.log.args;

          if (item.type === "registered") {

            return `
              <div class="activity-row">
                <div class="activity-main">
                  <strong>${escapeHTML(args.externalMachineId)} just launched</strong>
                  <span>${escapeHTML(args.name)} · ${timeLabel}</span>
                </div>
                <div class="activity-value">New</div>
              </div>
            `;

          }

          if (item.type === "invested") {

            const machineLabel =
              findMachineLabel(args.machineId);

            return `
              <div class="activity-row">
                <div class="activity-main">
                  <strong>${shortAddress(args.lender)} invested in ${escapeHTML(machineLabel)}</strong>
                  <span>Investment · ${timeLabel}</span>
                </div>
                <div class="activity-value">$${formatUSDT(args.amount)}</div>
              </div>
            `;

          }

          if (item.type === "deposited") {

            const machineLabel =
              findMachineLabel(args.machineId);

            return `
              <div class="activity-row">
                <div class="activity-main">
                  <strong>${escapeHTML(machineLabel)} revenue deposited</strong>
                  <span>Revenue settlement · ${timeLabel}</span>
                </div>
                <div class="activity-value">$${formatUSDT(args.revenue)}</div>
              </div>
            `;

          }

          const machineLabel =
            findMachineLabel(args.machineId);

          return `
            <div class="activity-row">
              <div class="activity-main">
                <strong>${shortAddress(args.lender)} claimed revenue</strong>
                <span>${escapeHTML(machineLabel)} · ${timeLabel}</span>
              </div>
              <div class="activity-value">$${formatUSDT(args.amount)}</div>
            </div>
          `;

        })
        .join("");

  } catch (error) {

    console.error(
      "Failed to load recent activity:",
      error
    );

    feed.innerHTML = `
      <div class="activity-row">
        <div class="activity-main">
          <strong>Unable to load activity</strong>
          <span>Please try again later</span>
        </div>
      </div>
    `;

  }

}

/* =========================================================
   MACHINE HELPERS
   ========================================================= */

function getMachineCategory(name) {

  const value =
    String(name || "").toLowerCase();

  if (value.includes("forklift")) {
    return "forklift";
  }

  if (
    value.includes("mobile") ||
    value.includes("amr")
  ) {
    return "amr";
  }

  if (
    value.includes("arm") ||
    value.includes("robotic")
  ) {
    return "arm";
  }

  return "arm";

}


/*
  Path gambar di Supabase: <kontrak>/<id onchain>/image
  Unik per deployment & per network, jadi gambar testnet,
  mainnet, dan kontrak lama tidak saling bertabrakan.
*/
function getMachineImagePath(onchainId) {

  return `${MACHINECREDIT_ADDRESS.toLowerCase()}/${onchainId}/image`;

}


function getMachineImage(category, onchainId) {

  if (onchainId) {

    const filePath =
      getMachineImagePath(onchainId);

    const {
      data
    } =
      supabaseClient
        .storage
        .from("machines")
        .getPublicUrl(filePath);

    if (data?.publicUrl) {
      return data.publicUrl;
    }

  }

  if (category === "amr") {
    return "asset/warehouse-amr.png";
  }

  return "asset/robot-arm.png";

}

function getMachineImageFallback(category) {

  if (category === "amr") {
    return "asset/warehouse-amr.png";
  }

  return "asset/robot-arm.png";

}

/* =========================================================
   LOAD MACHINES
   ========================================================= */

async function loadMachinesFromBlockchain() {

  const catalog =
    document.getElementById(
      "machineCatalog"
    );

  if (catalog) {

    catalog.innerHTML = `
      <div class="machine-loading-state">
        <span class="machine-loading-spinner"></span>
        <strong>Loading machines...</strong>
        <span>
          Fetching live machine data from blockchain.
        </span>
      </div>
    `;

  }

  try { 

    await new Promise(resolve =>
  setTimeout(resolve, 3000)
);

    const response =
      await fetch(
        `${API_BASE_URL}/machines`
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const result =
      await response.json();

    if (!result.success) {
      throw new Error(
        "Failed to load machines"
      );
    }

    blockchainMachines =
      Array.isArray(result.data)
        ? result.data
        : [];

    console.log(
      "Machines from blockchain:",
      blockchainMachines
    );

    renderBlockchainMachines(
      blockchainMachines
    );

    loadMonthlyRevenue();

    loadRecentActivity();

    if (userRole) {
      await initializeWalletRole(false);
    }

    if (userRole === "company") {
      populateSettlementMachineSelect();
    }

  } catch (error) {

    console.error(
      "Failed to load machines:",
      error
    );

    if (catalog) {

      catalog.innerHTML = `
        <div class="machine-error-state">

          <strong>
            Unable to load machines
          </strong>

          <span>
            Machine data is currently unavailable.
          </span>

          <button
            type="button"
            class="machine-retry-button"
            onclick="loadMachinesFromBlockchain()"
          >
            Retry
          </button>

        </div>
      `;

    }

    setText("totalMachines", "—");
    setText("openFinancing", "—");
    setText("monthlyRevenue", "—");

    showToast(
      "Failed to load machines from blockchain"
    );

  }

}

async function loadMonthlyRevenue(forceRefresh = false) {

  try {

    if (forceRefresh) {

      setText("monthlyRevenue", "…");

      await fetch(
        `${API_BASE_URL}/machines/monthly-revenue/refresh`,
        { method: "POST" }
      );

    }

    const response =
      await fetch(
        `${API_BASE_URL}/machines/monthly-revenue`
      );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error("Failed to load monthly revenue");
    }

    const total =
      Number(result.data?.total || 0);

    setText(
      "monthlyRevenue",
      `$${total.toLocaleString(
        undefined,
        {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2
        }
      )}`
    );

  } catch (error) {

    console.error(
      "Failed to load monthly revenue:",
      error
    );

    setText("monthlyRevenue", "$0");

  }

}

function renderBlockchainMachines(machineList) {

  console.log("RENDER CALLED");
  console.log("Machine list:", machineList);

  const catalog =
    document.getElementById("machineCatalog");

  if (!catalog) {
    console.error(
      "machineCatalog element NOT FOUND"
    );
    return;
  }

  console.log(
    "machineCatalog found:",
    catalog
  );

  catalog.innerHTML = "";

  let openFinancing = 0;

  machineList.forEach(machine => {

    console.log(
      "Rendering machine:",
      machine
    );

    const totalFunded =
      Number(machine.totalFunded || 0);

    const fundingTarget =
      Number(machine.fundingTarget || 0);

    let statusText = "Inactive";

    if (
      machine.financingStatus === "Completed"
    ) {

      statusText = "Repaid";

    } else if (
      machine.financingStatus === "Defaulted"
    ) {

      statusText = "Defaulted";

    } else if (machine.active) {

      if (
        fundingTarget > 0 &&
        totalFunded >= fundingTarget
      ) {

        statusText = "Fully Funded";

      } else {

        statusText = "Open for financing";
        openFinancing++;

      }

    }

    const category =
      getMachineCategory(
        machine.name
      );

    console.log(
      "Machine category:",
      category
    );

    const card =
      document.createElement("article");

    card.className =
      "machine-card";

    card.dataset.type =
      category;

    card.dataset.machineId =
      machine.machineId;

    const image =
      getMachineImage(
        category,
        machine.id
      );

    const fallbackImage =
      getMachineImageFallback(category);

    card.innerHTML = `

      <div class="machine-photo">

        <img
          src="${image}"
          alt="${escapeHTML(machine.machineId)}"
          onerror="this.onerror=null;this.src='${fallbackImage}';"
        >

        <div class="machine-status ${
          statusText === "Fully Funded" || statusText === "Repaid"
            ? "fully-funded"
            : statusText === "Defaulted"
              ? "defaulted"
              : ""
        }">

          <span class="status-dot"></span>

          ${statusText}

        </div>

      </div>

      <div class="machine-card-body">

        <div class="machine-card-title">
          ${escapeHTML(machine.machineId)}
        </div>

        <div class="machine-card-type">
          ${escapeHTML(machine.name)}
        </div>

        <div class="machine-card-metrics">

          <div class="machine-card-metric">

            <strong>
              ${Number(
                machine.performanceScore || 0
              )}%
            </strong>

            <span>
              Performance
            </span>

          </div>

          <div class="machine-card-metric">

            <strong>
              $${Number(
                machine.monthlyRevenue || 0
              ).toLocaleString()}
            </strong>

            <span>
              Monthly Revenue
            </span>

          </div>

          <div class="machine-card-metric">

            <strong>
              ${Number(
                machine.revenueSharePercent || 0
              )}%
            </strong>

            <span>
              Revenue Share
            </span>

          </div>

        </div>

        <button
          class="machine-card-button"
          onclick="showMachineDetail(${Number(
            machine.id
          )})"
        >
          View Details →
        </button>

      </div>

    `;

    catalog.appendChild(card);

  });

  console.log(
    "Cards rendered:",
    catalog.children.length
  );

  console.log(
    "Open financing:",
    openFinancing
  );

  setText(
    "totalMachines",
    machineList.length
  );

  setText(
    "openFinancing",
    openFinancing
  );

  filterMachines(
    document.getElementById(
      "machineSearch"
    )?.value || ""
  );

}

/* =========================================================
   PORTFOLIO
   ========================================================= */

async function loadPortfolio() {

  if (!walletAddress) {

    renderEmptyPortfolio();

    return;

  }

  try {

    const response =
      await fetch(
        `${API_BASE_URL}/portfolio/${walletAddress}`
      );

    if (!response.ok) {

      throw new Error(
        `HTTP ${response.status}`
      );

    }

    const result =
      await response.json();

    if (!result.success) {

      throw new Error(
        "Failed to load portfolio"
      );

    }

    renderPortfolio(result);

  } catch (error) {

    console.error(
      "Failed to load portfolio:",
      error
    );

    showToast(
      "Failed to load portfolio"
    );

  }

}


function renderEmptyPortfolio() {

  setText(
    "portfolioCapital",
    "$0"
  );

  setText(
    "portfolioRevenue",
    "$0"
  );

  setText(
    "portfolioPositions",
    "0"
  );

  setText(
    "portfolioPerformance",
    "—"
  );

  setText(
    "portfolioMachineCount",
    "Across 0 active machines"
  );


  const body =
    document.getElementById(
      "positionBody"
    );

  if (body) {

    body.innerHTML = `
      <tr>
        <td
          colspan="6"
          style="
            text-align:center;
            padding:40px;
            color:#8a97a8;
          "
        >
          Connect a lender wallet to view your positions
        </td>
      </tr>
    `;

  }

}


function renderPortfolio(data) {

  const positions =
    data.positions || [];


  setText(
    "portfolioCapital",
    `$${formatUSDT(
      data.totalInvested
    )}`
  );


  setText(
    "portfolioRevenue",
    `$${formatUSDT(
      data.totalEarned
    )}`
  );


  setText(
    "portfolioPositions",
    positions.length
  );


  const performance =
    Number(
      data.averagePerformance || 0
    );


  setText(
    "portfolioPerformance",
    positions.length
      ? `${performance.toFixed(1)}%`
      : "—"
  );


  setText(
    "portfolioMachineCount",
    `Across ${positions.length} active machine${
      positions.length === 1
        ? ""
        : "s"
    }`
  );


  const body =
    document.getElementById(
      "positionBody"
    );

  if (!body) {
    return;
  }


  if (!positions.length) {

    body.innerHTML = `
      <tr>
        <td
          colspan="6"
          style="
            text-align:center;
            padding:40px;
            color:#8a97a8;
          "
        >
          No active positions
        </td>
      </tr>
    `;

    return;

  }


  body.innerHTML =
    positions
      .map(position => {

        const machineId =
          position.externalMachineId ||
          `Machine ${position.machineId}`;

        const machineName =
          position.machineName ||
          "Unknown Machine";

        const pending =
          Number(
            position.pendingRevenue || 0
          );


        return `
          <tr>

            <td>

              <span class="position-name">
                ${escapeHTML(
                  machineId
                )}
              </span>

              <span class="position-sub">
                ${escapeHTML(
                  machineName
                )}
              </span>

            </td>


            <td>
              $${formatUSDT(
                position.invested
              )}
            </td>


            <td>
              ${Number(
                position.revenueSharePercent || 0
              )}%
            </td>


            <td>

              <div class="revenue-cell">

                <span class="positive">
                  $${formatUSDT(
                    position.totalEarned
                  )}
                </span>

                ${
                  pending > 0
                    ? `
                      <button
                        class="claim-revenue-btn"
                        onclick="claimRevenue(${Number(
                          position.machineId
                        )})"
                      >
                        Claim $${formatUSDT(
                          pending
                        )}
                      </button>
                    `
                    : ""
                }

              </div>

            </td>


            <td>

              <div class="revenue-cell">

                <span class="${
                  position.financingStatus === "Defaulted"
                    ? "negative"
                    : ""
                }">
                  ${position.financingStatus || "Open"}
                </span>

                ${
                  Number(position.claimablePrincipal || 0) > 0
                    ? `
                      <button
                        class="claim-revenue-btn"
                        onclick="claimPrincipal(${Number(
                          position.machineId
                        )})"
                      >
                        Claim $${formatUSDT(
                          position.claimablePrincipal
                        )}
                      </button>
                    `
                    : ""
                }

              </div>

            </td>

            <td>

              <span
                class="${
                  position.financingStatus === "Defaulted"
                    ? "negative"
                    : position.active
                      ? "positive"
                      : ""
                }"
              >
                ● ${
                  position.financingStatus &&
                  position.financingStatus !== "Open"
                    ? position.financingStatus
                    : position.active
                      ? "Active"
                      : "Closed"
                }
              </span>

            </td>

          </tr>
        `;

      })
      .join("");

}

/* =========================================================
   NAVIGATION
   ========================================================= */

function showView(view) {

  if (
    view === "launch" &&
    userRole !== "company"
  ) {

    showToast(
      "Connect a company wallet to launch a machine"
    );

    return;

  }


  if (
    view === "portfolio" &&
    userRole !== "lender"
  ) {

    showToast(
      "Connect a lender wallet to view your portfolio"
    );

    return;

  }


  if (
    view === "settlement" &&
    userRole !== "company"
  ) {

    showToast(
      "Connect a company wallet to deposit revenue"
    );

    return;

  }

  
  if (view === "settlement") {

    populateSettlementMachineSelect();

  }

  document
    .querySelectorAll(
      ".app-view"
    )
    .forEach(element => {

      element.classList.remove(
        "active"
      );

    });


  const target =
    document.getElementById(
      `view-${view}`
    );


  if (target) {

    target.classList.add(
      "active"
    );

  }


  document
    .querySelectorAll(
      ".app-tab"
    )
    .forEach(tab => {

      tab.classList.toggle(
        "active",
        tab.dataset.view === view
      );

    });


  const detail =
    document.getElementById(
      "view-detail"
    );


  if (
    view !== "detail" &&
    detail
  ) {

    detail.classList.remove(
      "active"
    );

  }


  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

}

/* =========================================================
   MACHINE DETAIL
   ========================================================= */

function hashSeed(str) {

  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }

  return hash;

}

function mulberry32(seed) {

  return function () {

    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;

    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;

  };

}

function generateProgressShape(seedStr) {

  const rand = mulberry32(hashSeed(String(seedStr || "machine")));

  const steps = 10;

  const shape = [0];

  let last = 0;

  for (let i = 1; i <= steps; i++) {

    const base = i / (steps + 1);

    const noise = (rand() - 0.5) * 0.18;

    let value = base + noise;

    value = Math.max(last - 0.05, Math.min(0.97, value));

    shape.push(value);

    last = value;

  }

  shape.push(1);

  return shape;

}

function updatePerformanceChart(performance, machineSeed) {

  const line =
    document.getElementById(
      "performanceChartLine"
    );

  const fill =
    document.getElementById(
      "performanceChartFill"
    );

  const chartValue =
    document.getElementById(
      "detailChartValue"
    );

  if (!line || !fill) {
    return;
  }

  const finalValue =
    Math.max(
      0,
      Math.min(
        Number(performance || 0),
        100
      )
    );

  const progressShape =
    generateProgressShape(machineSeed);

  const points = [];

  progressShape.forEach(
    (progress, index) => {

      const x =
        (600 / (progressShape.length - 1)) *
        index;

      const value =
        finalValue * progress;

      const y =
        150 -
        (value / 100) * 120;

      points.push({
        x,
        y
      });

    }
  );

  const linePoints =
    points
      .map(
        point =>
          `${point.x},${point.y}`
      )
      .join(" ");

  line.setAttribute(
    "points",
    linePoints
  );

  const first =
    points[0];

  const last =
    points[points.length - 1];

  const middlePath =
    points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${point.x} ${point.y}`
      )
      .join(" ");

  const fillPath = `
    ${middlePath}
    L ${last.x} 170
    L ${first.x} 170
    Z
  `;

  fill.setAttribute(
    "d",
    fillPath
  );

  if (chartValue) {
    chartValue.textContent =
      `${finalValue.toFixed(0)}%`;
  }

}
   
function showMachineDetail(machineId) {

  currentMachineId =
    Number(machineId);


  const data =
    blockchainMachines.find(
      machine =>
        Number(machine.id) ===
        Number(machineId)
    );


  if (!data) {

    showToast(
      "Machine data not found"
    );

    return;

  }


  document
    .querySelectorAll(
      ".app-view"
    )
    .forEach(element => {

      element.classList.remove(
        "active"
      );

    });


  const detailView =
    document.getElementById(
      "view-detail"
    );


  if (detailView) {

    detailView.classList.add(
      "active"
    );

  }


  document
    .querySelectorAll(
      ".app-tab"
    )
    .forEach(tab => {

      tab.classList.remove(
        "active"
      );

    });


  setText(
    "detailName",
    data.machineId
  );

  setText(
    "verifiedMachineId",
    data.machineId
  );

  setText(
    "verifiedMachineOwner",
    data.owner
  );

  setText(
    "verifiedContract",
    MACHINECREDIT_ADDRESS
  );

  const explorerLink =
    document.getElementById(
      "verifiedExplorerLink"
    );

  if (explorerLink) {
    explorerLink.href =
      `${EXPLORER_URL}/address/${MACHINECREDIT_ADDRESS}`;
  }

  setText(
    "detailType",
    `${String(
      data.name
    ).toUpperCase()} · BOT CHAIN`
  );


  setText(
    "detailPerformance",
    `${Number(
      data.performanceScore || 0
    )}%`
  );

  updatePerformanceChart(
    data.performanceScore,
    data.machineId
  );

  setText(
    "detailRevenue",
    `$${Number(
      data.monthlyRevenue || 0
    ).toLocaleString()}`
  );


  setText(
    "detailUptime",
    "—"
  );


  setText(
    "detailJobs",
    "—"
  );

    setText(
    "fundingTarget",
    `$${formatUSDT(data.fundingTarget || 0)}`
  );


  setText(
    "totalFunded",
    `$${formatUSDT(data.totalFunded || 0)}`
  );


  setText(
    "revenueShare",
    `${Number(
      data.revenueSharePercent || 0
    )}%`
  );


  setText(
    "fundingTerm",
    "12 months"
  );


  setText(
    "expectedRevenue",
    `$${Number(
      data.monthlyRevenue || 0
    ).toLocaleString()}`
  );


  const target =
    Number(
      data.fundingTarget || 0
    );


  const funded =
    Number(
      data.totalFunded || 0
    );


  const progress =
    target > 0
      ? Math.min(
          (funded / target) * 100,
          100
        )
      : 0;


  setText(
    "fundingProgressText",
    `${progress.toFixed(1)}% funded`
  );


  setText(
    "fundingRemaining",
    `$${formatUSDT(
      Math.max(target - funded, 0)
    )} remaining`
  );


  const progressBar =
    document.getElementById(
      "fundingProgressBar"
    );


  if (progressBar) {

    progressBar.style.width =
      `${progress}%`;

  }

    const isFullyFunded =
    target > 0 &&
    funded >= target;

  const investButton =
    document.getElementById(
      "investButton"
    );

  const investInput =
    document.getElementById(
      "investmentAmount"
    );

  if (investButton) {

    investButton.disabled =
      isFullyFunded;

    investButton.classList.toggle(
      "btn-disabled",
      isFullyFunded
    );

    investButton.textContent =
      isFullyFunded
        ? "Fully Funded"
        : "Invest in Machine →";

  }

  if (investInput) {

    investInput.disabled =
      isFullyFunded;

  }

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

}

/* =========================================================
   SEARCH / FILTER
   ========================================================= */

function filterMachines(query) {

  const q =
    String(query || "")
      .trim()
      .toLowerCase();


  document
    .querySelectorAll(
      "#machineCatalog .machine-card"
    )
    .forEach(card => {

      const matchesSearch =
        card.textContent
          .toLowerCase()
          .includes(q);


      const matchesFilter =
        currentFilter === "all" ||
        card.dataset.type ===
          currentFilter;


      card.style.display =
        matchesSearch &&
        matchesFilter
          ? ""
          : "none";

    });

}


function setFilter(button, filter) {

  currentFilter =
    filter;


  document
    .querySelectorAll(
      ".filter-btn"
    )
    .forEach(btn => {

      btn.classList.remove(
        "active"
      );

    });


  if (button) {

    button.classList.add(
      "active"
    );

  }


  filterMachines(
    document.getElementById(
      "machineSearch"
    )?.value || ""
  );

}

/* =========================================================
   ROLE SYSTEM
   ========================================================= */

function showRoleModal() {

  document
    .getElementById(
      "roleModal"
    )
    ?.classList.add(
      "active"
    );

}


function hideRoleModal() {

  document
    .getElementById(
      "roleModal"
    )
    ?.classList.remove(
      "active"
    );

}


function selectRole(role) {

  if (
    role !== "company" &&
    role !== "lender"
  ) {
    return;
  }

  if (!walletAddress) {

    showToast(
      "Connect your wallet first"
    );

    return;
  }

  const storageKey =
    `machinecredit_role_${walletAddress.toLowerCase()}`;

  /*
    Simpan role secara persistent.
  */

  localStorage.setItem(
    storageKey,
    role
  );

  userRole = role;

  hideRoleModal();

  applyRoleUI();

  showToast(
    role === "company"
      ? "Company profile selected"
      : "Lender profile selected"
  );

  console.log(
    "Registered role:",
    role
  );
}


async function initializeWalletRole(
  showModalIfMissing = true
) {

  if (!walletAddress) {
    return null;
  }

  const storageKey =
    `machinecredit_role_${walletAddress.toLowerCase()}`;

  const savedRole =
    localStorage.getItem(storageKey);

  /*
    Wallet sudah pernah memilih role.
    Gunakan role tersebut.
  */

  if (
    savedRole === "company" ||
    savedRole === "lender"
  ) {

    userRole = savedRole;

    applyRoleUI();

    console.log(
      `Existing role found: ${savedRole}`
    );

    return savedRole;
  }

  /*
    Wallet belum terdaftar.
  */

  userRole = null;

  applyRoleUI();

  if (showModalIfMissing) {

    showRoleModal();

  }

  return null;
}


function applyRoleUI() {

  const launchTab =
    document.querySelector(
      '.app-tab[data-view="launch"]'
    );


  const portfolioTab =
    document.querySelector(
      '.app-tab[data-view="portfolio"]'
    );


  const settlementTab =
    document.querySelector(
      '.app-tab[data-view="settlement"]'
    );


  if (launchTab) {

    launchTab.style.display =
      userRole === "company"
        ? ""
        : "none";

  }


  if (portfolioTab) {

    portfolioTab.style.display =
      userRole === "lender"
        ? ""
        : "none";

  }


  if (settlementTab) {

    settlementTab.style.display =
      userRole === "company"
        ? ""
        : "none";

  }


  if (
    userRole === "company" &&
    document
      .getElementById(
        "view-portfolio"
      )
      ?.classList.contains(
        "active"
      )
  ) {

    showView(
      "discover"
    );

  }


  if (
    userRole === "lender" &&
    (
      document
        .getElementById(
          "view-launch"
        )
        ?.classList.contains(
          "active"
        ) ||
      document
        .getElementById(
          "view-settlement"
        )
        ?.classList.contains(
          "active"
        )
    )
  ) {

    showView(
      "discover"
    );

  }

}

/* =========================================================
   BOT CHAIN
   ========================================================= */

async function ensureBotChain() {

  if (!window.ethereum) {

    throw new Error(
      "Please install MetaMask"
    );

  }


  provider =
    new ethers.BrowserProvider(
      window.ethereum
    );


  const network =
    await provider.getNetwork();


  if (
    Number(
      network.chainId
    ) !== BOT_CHAIN_ID
  ) {

    try {

      await window.ethereum.request({
        method:
          "wallet_switchEthereumChain",

        params: [
          {
            chainId:
              BOT_CHAIN_HEX
          }
        ]
      });

    } catch (error) {

      if (
        error.code !== 4902
      ) {

        throw error;

      }


      await window.ethereum.request({

        method:
          "wallet_addEthereumChain",

        params: [

          {

            chainId:
              BOT_CHAIN_HEX,

            chainName:
              NETWORK.chainName,

            nativeCurrency: {

              name:
                "BOT",

              symbol:
                "BOT",

              decimals:
                18

            },

            rpcUrls: [
              BOT_RPC_URL
            ],

            blockExplorerUrls: [
              EXPLORER_URL
            ]

          }

        ]

      });

    }


    provider =
      new ethers.BrowserProvider(
        window.ethereum
      );

  }

}

/* =========================================================
   CONNECT WALLET
   ========================================================= */

async function connectWallet() {

  try {

    await ensureBotChain();


    await provider.send(
      "eth_requestAccounts",
      []
    );


    signer =
      await provider.getSigner();


    walletAddress =
      await signer.getAddress();


    connected =
      true;


    updateWalletUI(
      walletAddress
    );


    await initializeWalletRole(
      true
    );

    setupOnchainEventListeners();

    await catchUpMissedEvents();

    await loadPortfolio();


    showToast(
      `Wallet connected: ${walletAddress.slice(
        0,
        6
      )}...${walletAddress.slice(
        -4
      )}`
    );

  } catch (error) {

    console.error(
      "Wallet connection failed:",
      error
    );


    if (
      error?.code !== 4001
    ) {

      showToast(
        error?.shortMessage ||
        error?.message ||
        "Failed to connect wallet"
      );

    }

  }

}

/* =========================================================
   SWITCH WALLET
   ========================================================= */

async function switchWallet() {

  try {

    if (!window.ethereum) {

      showToast(
        "Please install MetaMask"
      );

      return;

    }


    /*
      Buka permission/account selector MetaMask.
      User bisa memilih wallet lain yang ingin
      dihubungkan ke website.
    */

    await window.ethereum.request({

      method:
        "wallet_requestPermissions",

      params: [

        {
          eth_accounts: {}
        }

      ]

    });


    /*
      Pastikan tetap di BOT Chain (sesuai ACTIVE_NETWORK).
    */

    await ensureBotChain();


    /*
      Ambil account TERBARU dari MetaMask.
      Jangan menggunakan signer lama.
    */

    const accounts =
      await window.ethereum.request({

        method:
          "eth_accounts"

      });


    if (
      !accounts ||
      accounts.length === 0
    ) {

      disconnectWallet();

      return;

    }


    const newAddress =
      accounts[0];


    /*
      Buat provider + signer baru
      berdasarkan account terbaru.
    */

    provider =
      new ethers.BrowserProvider(
        window.ethereum
      );


    signer =
      await provider.getSigner(
        newAddress
      );


    walletAddress =
      newAddress;


    connected =
      true;


    /*
      Update seluruh state frontend
      berdasarkan wallet baru.
    */

    userRole = null;

    eventsContract?.removeAllListeners();

    eventsContract = null;

    notifications = [];


    updateWalletUI(
      walletAddress
    );


    await initializeWalletRole(
      true
    );


    setupOnchainEventListeners();

    await catchUpMissedEvents();

    await loadPortfolio();


    hideWalletMenu();


    showToast(
      `Switched to ${walletAddress.slice(
        0,
        6
      )}...${walletAddress.slice(
        -4
      )}`
    );


    console.log(
      "Switched wallet:",
      walletAddress
    );


  } catch (error) {

    console.error(
      "Wallet switch failed:",
      error
    );


    if (
      error?.code === 4001
    ) {

      showToast(
        "Wallet switch cancelled"
      );

      return;

    }


    showToast(
      error?.shortMessage ||
      error?.message ||
      "Failed to switch wallet"
    );

  }

}

/* =========================================================
   DISCONNECT WALLET
   ========================================================= */

function disconnectWallet() {

  /*
    Hanya mereset session frontend.
    JANGAN hapus role di localStorage.
  */

  connected = false;

  walletAddress = null;

  signer = null;

  provider = null;

  userRole = null;

  eventsContract?.removeAllListeners();

  eventsContract = null;

  notifications = [];


  updateWalletDisconnectedUI();

  applyRoleUI();

  renderEmptyPortfolio();

  renderNotifications();

  hideRoleModal();

  hideWalletMenu();

  showToast(
    "Wallet disconnected"
  );

}


async function handleWalletButton() {

  if (
    !connected ||
    !walletAddress
  ) {

    return connectWallet();

  }

  /*
    Wallet sudah connect: klik tombol
    membuka dropdown Switch Wallet / Disconnect,
    bukan langsung switch.
  */

  toggleWalletMenu();

}


function toggleWalletMenu() {

  document
    .getElementById(
      "walletMenu"
    )
    ?.classList.toggle(
      "active"
    );

}


function hideWalletMenu() {

  document
    .getElementById(
      "walletMenu"
    )
    ?.classList.remove(
      "active"
    );

}


function updateWalletUI(address) {

  setText(
    "walletLabel",
    `${address.slice(
      0,
      6
    )}...${address.slice(
      -4
    )}`
  );


  document
    .querySelector(
      ".app-wallet"
    )
    ?.classList.add(
      "connected"
    );

}


function updateWalletDisconnectedUI() {

  setText(
    "walletLabel",
    "Connect Wallet"
  );


  document
    .querySelector(
      ".app-wallet"
    )
    ?.classList.remove(
      "connected"
    );

}

/* =========================================================
   INVEST / FUND MACHINE
   ========================================================= */

async function fundMachine() {

  try {

    if (
      userRole !== "lender"
    ) {

      showToast(
        "Select the lender role to invest"
      );

      return;

    }


    if (!signer) {

      await connectWallet();

    }


    if (!signer) {
      return;
    }


    const input =
      document.getElementById(
        "investmentAmount"
      );


    const amount =
      String(
        input?.value || ""
      ).trim();


    if (
      !amount ||
      Number(amount) <= 0
    ) {

      showToast(
        "Enter an investment amount"
      );

      return;

    }


    if (
      currentMachineId === null
    ) {

      showToast(
        "Machine not selected"
      );

      return;

    }

        const machineData =
      blockchainMachines.find(
        machine =>
          Number(machine.id) ===
          Number(currentMachineId)
      );

    if (
      machineData &&
      Number(machineData.fundingTarget || 0) > 0 &&
      Number(machineData.totalFunded || 0) >=
        Number(machineData.fundingTarget || 0)
    ) {

      showToast(
        "This machine is already fully funded"
      );

      return;

    }

    const amountRaw =
      ethers.parseUnits(
        amount,
        6
      );


    const machineContract =
      new ethers.Contract(
        MACHINECREDIT_ADDRESS,
        MACHINECREDIT_ABI,
        signer
      );


    const usdtContract =
      new ethers.Contract(
        USDT_ADDRESS,
        USDT_ABI,
        signer
      );


    const balance =
      await usdtContract.balanceOf(
        walletAddress
      );


    if (
      balance < amountRaw
    ) {

      showToast(
        "Insufficient USDT balance"
      );

      return;

    }


    showToast(
      "Approve USDT in MetaMask..."
    );


    const approveTx =
      await usdtContract.approve(
        MACHINECREDIT_ADDRESS,
        amountRaw
      );


    await approveTx.wait();


    showToast(
      "Confirm investment in MetaMask..."
    );


    const investTx =
      await machineContract.invest(
        currentMachineId,
        amountRaw
      );


    showToast(
      "Investment submitted..."
    );


    await investTx.wait();


    showTransactionToast(
      `Investment successful — ${amount} USDT`,
      investTx.hash
    );


    await loadMachinesFromBlockchain();

    await loadMonthlyRevenue(true);

    await loadPortfolio();

  } catch (error) {

    console.error(
      "Investment failed:",
      error
    );


    if (
      error?.code === 4001 ||
      error?.code === "ACTION_REJECTED"
    ) {

      showToast(
        "Transaction rejected"
      );

      return;

    }


    showToast(
      error?.shortMessage ||
      error?.reason ||
      error?.message ||
      "Investment failed"
    );

  }

}

/* =========================================================
   CLAIM REVENUE
   ========================================================= */

async function claimRevenue(
  machineId
) {

  try {

    if (
      userRole !== "lender"
    ) {

      showToast(
        "Select the lender role to claim revenue"
      );

      return;

    }


    if (!signer) {

      await connectWallet();

    }


    if (!signer) {
      return;
    }


    const contract =
      new ethers.Contract(
        MACHINECREDIT_ADDRESS,
        MACHINECREDIT_ABI,
        signer
      );


    const pending =
      await contract.getPendingRevenue(
        machineId,
        walletAddress
      );


    if (
      pending === 0n
    ) {

      showToast(
        "No revenue available to claim"
      );

      return;

    }


    const amount =
      ethers.formatUnits(
        pending,
        6
      );


    showToast(
      "Confirm claim in MetaMask..."
    );


    const tx =
      await contract.claimRevenue(
        machineId
      );


    showToast(
      "Claim submitted..."
    );


    await tx.wait();


    showTransactionToast(
      `Revenue claimed — ${amount} USDT`,
      tx.hash
    );


    await loadPortfolio();

    await loadRecentActivity();

  } catch (error) {

    console.error(
      "Claim revenue failed:",
      error
    );


    if (
      error?.code === 4001 ||
      error?.code === "ACTION_REJECTED"
    ) {

      showToast(
        "Transaction rejected"
      );

      return;

    }


    showToast(
      error?.shortMessage ||
      error?.reason ||
      error?.message ||
      "Claim failed"
    );

  }

}

/* =========================================================
   MACHINE IMAGE UPLOAD (localStorage-based, no backend yet)
   ========================================================= */

function getMachineImageStorageKey(machineId) {

  return `machinecredit_image_${String(machineId).toUpperCase()}`;

}


function handleMachineImageSelected(input) {

  const file =
    input.files?.[0];

  if (!file) {
    return;
  }

  // Sama dengan batas bucket "machines" di Supabase
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

  const ALLOWED_IMAGE_TYPES = [
    "image/png",
    "image/jpeg",
    "image/webp"
  ];

  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {

    showToast(
      "Image must be PNG, JPG, or WebP"
    );

    input.value = "";

    return;

  }

  if (file.size > MAX_IMAGE_BYTES) {

    showToast(
      "Image must be 5 MB or smaller"
    );

    input.value = "";

    return;

  }

  selectedMachineImageFile = file;

  const reader =
    new FileReader();

  reader.onload = () => {

    const label =
      document.getElementById(
        "uploadBoxLabel"
      );

    if (label) {

      label.classList.add(
        "has-image"
      );

      label.innerHTML = `
        <img
          src="${reader.result}"
          class="upload-preview-thumb"
          alt="Selected machine"
        >
        <strong>${escapeHTML(file.name)}</strong>
        <span>Click to change image</span>
      `;

    }

  };

  reader.readAsDataURL(file);

}


function resetMachineImageUpload() {

  selectedMachineImageFile = null;

  const label =
    document.getElementById(
      "uploadBoxLabel"
    );

  if (label) {

    label.classList.remove(
      "has-image"
    );

    label.innerHTML = `
      <div class="upload-icon">↑</div>
      <strong>Drag or search file here</strong>
      <span>PNG, JPG or WEBP</span>
    `;

  }

}

/* =========================================================
   REGISTER MACHINE
   ========================================================= */

async function registerMachine(
  event
) {

  event.preventDefault();


  try {

    if (
      userRole !== "company"
    ) {

      showToast(
        "Select the company role to launch a machine"
      );

      return;

    }


    if (!signer) {

      await connectWallet();

    }


    if (!signer) {
      return;
    }


    const id =
      document
        .getElementById(
          "machineIdInput"
        )
        ?.value
        .trim()
        .toUpperCase();


    const typeSelect =
      document.getElementById(
        "machineTypeInput"
      );


    const type =
      typeSelect
        ?.options[
          typeSelect.selectedIndex
        ]
        ?.text ||
      "Robotic Machine";


    const revenue =
      Number(
        document.getElementById(
          "machineRevenueInput"
        )?.value || 0
      );


    const performance =
      Number(
        document.getElementById(
          "machinePerformanceInput"
        )?.value || 0
      );


    const uptime =
      Number(
        document.getElementById(
          "machineUptimeInput"
        )?.value || 0
      );


    const funding =
      Number(
        document.getElementById(
          "machineFundingInput"
        )?.value || 0
      );


    const share =
      Number(
        document.getElementById(
          "machineShareInput"
        )?.value || 20
      );


    if (
      !id ||
      !revenue ||
      !performance ||
      !funding
    ) {

      showToast(
        "Please complete the required fields"
      );

      return;

    }


    if (
      performance < 0 ||
      performance > 100
    ) {

      showToast(
        "Performance must be between 0 and 100"
      );

      return;

    }


    if (
      uptime < 0 ||
      uptime > 100
    ) {

      showToast(
        "Uptime must be between 0 and 100"
      );

      return;

    }


    if (
      share <= 0 ||
      share > 100
    ) {

      showToast(
        "Revenue share must be between 1 and 100"
      );

      return;

    }


    const contract =
      new ethers.Contract(
        MACHINECREDIT_ADDRESS,
        MACHINECREDIT_ABI,
        signer
      );


    showToast(
      "Confirm machine registration in MetaMask..."
    );


      const fundingRaw =
      ethers.parseUnits(
        String(funding),
        6
      );

    const tx =
      await contract.registerMachine(
        id,
        type,
        performance,
        revenue,
        fundingRaw,
        share
      );


    showToast(
      "Registering machine onchain..."
    );


    const receipt =
      await tx.wait();


        showTransactionToast(
      `${id} registered onchain`,
      tx.hash
    );


    /*
      Ambil id onchain dari event MachineRegistered
      untuk path gambar di Supabase.
    */

    let onchainId = null;

    for (const log of receipt.logs) {

      try {

        const parsed =
          contract.interface.parseLog(log);

        if (parsed?.name === "MachineRegistered") {
          onchainId =
            parsed.args.machineId.toString();
          break;
        }

      } catch {
        // log dari kontrak lain, abaikan
      }

    }


    if (selectedMachineImageFile && onchainId) {

  try {

    const file =
      selectedMachineImageFile;

    const filePath =
      getMachineImagePath(onchainId);

    const { error: uploadError } =
      await supabaseClient
        .storage
        .from("machines")
        .upload(
          filePath,
          file,
          {
            contentType: file.type
          }
        );

    if (uploadError) {
      throw uploadError;
    }

  } catch (uploadError) {

    console.error(
      "Machine image upload failed:",
      uploadError
    );

    showToast(
      "Machine registered, but image upload failed"
    );

  }

}


    document
      .getElementById(
        "launchForm"
      )
      ?.reset();

    resetMachineImageUpload();


    await loadMachinesFromBlockchain();


    setTimeout(() => {

      showView(
        "discover"
      );

      scrollToMarket();

    }, 700);

  } catch (error) {

    console.error(
      "Register machine error:",
      error
    );


    if (
      error?.code === 4001 ||
      error?.code === "ACTION_REJECTED"
    ) {

      showToast(
        "Transaction cancelled"
      );

      return;

    }


    if (
      error?.reason === "Company not approved"
    ) {

      showToast(
        "This wallet is not an approved company yet. Contact the admin."
      );

      return;

    }


    showToast(
      error?.reason ||
      error?.shortMessage ||
      error?.message ||
      "Failed to register machine"
    );

  }

}

/* =========================================================
   SETTLEMENT MACHINE SELECTOR (multi-machine)
   ========================================================= */

function getCompanyMachines() {

  if (!walletAddress) {
    return [];
  }

  return blockchainMachines.filter(
    machine =>
      String(machine.owner || "").toLowerCase() ===
      walletAddress.toLowerCase()
  );

}


function populateSettlementMachineSelect() {

  const select =
    document.getElementById(
      "settlementMachineSelect"
    );

  if (!select) {
    return;
  }

  const companyMachines =
    getCompanyMachines();

  if (!companyMachines.length) {

    select.innerHTML =
      `<option value="">No machines registered</option>`;

    currentSettlementMachineId = null;

    updateSettlementShareDisplay(null);

    return;

  }

  select.innerHTML = companyMachines
    .map(
      machine => `
        <option value="${Number(machine.id)}">
          ${escapeHTML(machine.machineId)} — ${escapeHTML(machine.name)}
        </option>
      `
    )
    .join("");

  currentSettlementMachineId =
    Number(select.value);

  updateSettlementShareDisplay(
    currentSettlementMachineId
  );

  loadSettlementFinancing(
    currentSettlementMachineId
  );

}


function onSettlementMachineChange() {

  const select =
    document.getElementById(
      "settlementMachineSelect"
    );

  currentSettlementMachineId =
    select?.value
      ? Number(select.value)
      : null;

  updateSettlementShareDisplay(
    currentSettlementMachineId
  );

  loadSettlementFinancing(
    currentSettlementMachineId
  );

}


function updateSettlementShareDisplay(machineId) {

  const machine =
    blockchainMachines.find(
      m => Number(m.id) === Number(machineId)
    );

  const lenderShare =
    machine
      ? Number(machine.revenueSharePercent || 0)
      : 0;

  setText(
    "settlementLenderShare",
    `${lenderShare}%`
  );

  setText(
    "settlementCompanyShare",
    `${100 - lenderShare}%`
  );

}


async function loadSettlementFinancing(machineId) {

  const statusEl =
    document.getElementById("settlementFinancingStatus");

  const availableEl =
    document.getElementById("settlementAvailableWithdraw");

  const withdrawBtn =
    document.getElementById("withdrawFundingButton");

  const repayBtn =
    document.getElementById("repayPrincipalButton");

  const repayInput =
    document.getElementById("repayPrincipalInput");

  if (!machineId) {

    if (statusEl) statusEl.textContent = "—";
    if (availableEl) availableEl.textContent = "$0";

    return;

  }

  try {

    const readContract =
      new ethers.Contract(
        MACHINECREDIT_ADDRESS,
        MACHINECREDIT_ABI,
        readOnlyProvider
      );

    const financing =
      await readContract.getFinancing(machineId);

    const statusCode =
      Number(financing[5]);

    const statusLabel =
      FINANCING_STATUS_LABEL[statusCode] || "Unknown";

    const isOpen =
      statusCode === 0;

    const availableToWithdraw =
      financing[2];

    if (statusEl) {
      statusEl.textContent = statusLabel;
    }

    if (availableEl) {
      availableEl.textContent =
        `$${formatUSDT(availableToWithdraw)}`;
    }

    if (withdrawBtn) {

      const disabled =
        !isOpen || availableToWithdraw === 0n;

      withdrawBtn.disabled = disabled;

      withdrawBtn.classList.toggle(
        "btn-disabled",
        disabled
      );

    }

    if (repayBtn) {

      repayBtn.disabled = !isOpen;

      repayBtn.classList.toggle(
        "btn-disabled",
        !isOpen
      );

    }

    if (repayInput) {
      repayInput.disabled = !isOpen;
    }

  } catch (error) {

    console.error(
      "Failed to load financing status:",
      error
    );

    if (statusEl) {
      statusEl.textContent = "—";
    }

  }

}


async function withdrawFundingFromUI() {

  try {

    if (userRole !== "company") {

      showToast(
        "Select the company role to withdraw funding"
      );

      return;

    }

    if (!signer) {
      await connectWallet();
    }

    if (!signer) {
      return;
    }

    const machineId =
      currentSettlementMachineId;

    if (!machineId) {

      showToast(
        "Select a machine first"
      );

      return;

    }

    const contract =
      new ethers.Contract(
        MACHINECREDIT_ADDRESS,
        MACHINECREDIT_ABI,
        signer
      );

    showToast(
      "Confirm withdrawal in MetaMask..."
    );

    const tx =
      await contract.withdrawFunding(machineId);

    showToast(
      "Withdrawal submitted..."
    );

    await tx.wait();

    showTransactionToast(
      "Funding withdrawn",
      tx.hash
    );

    await loadSettlementFinancing(machineId);

    await loadMachinesFromBlockchain();

  } catch (error) {

    console.error(
      "Withdraw funding failed:",
      error
    );

    if (
      error?.code === 4001 ||
      error?.code === "ACTION_REJECTED"
    ) {

      showToast(
        "Transaction rejected"
      );

      return;

    }

    showToast(
      error?.shortMessage ||
      error?.reason ||
      error?.message ||
      "Withdraw failed"
    );

  }

}


async function repayPrincipalFromUI() {

  try {

    if (userRole !== "company") {

      showToast(
        "Select the company role to repay principal"
      );

      return;

    }

    if (!signer) {
      await connectWallet();
    }

    if (!signer) {
      return;
    }

    const machineId =
      currentSettlementMachineId;

    if (!machineId) {

      showToast(
        "Select a machine first"
      );

      return;

    }

    const input =
      document.getElementById(
        "repayPrincipalInput"
      );

    const amount =
      String(
        input?.value || ""
      ).trim();

    if (
      !amount ||
      Number(amount) <= 0
    ) {

      showToast(
        "Enter repayment amount"
      );

      return;

    }

    const amountRaw =
      ethers.parseUnits(
        amount,
        6
      );

    const readContract =
      new ethers.Contract(
        MACHINECREDIT_ADDRESS,
        MACHINECREDIT_ABI,
        readOnlyProvider
      );

    const financingCheck =
      await readContract.getFinancing(machineId);

    const totalFundedRaw =
      financingCheck[0];

    if (Number(financingCheck[5]) !== 0) {

      showToast(
        "Financing already settled for this machine"
      );

      await loadSettlementFinancing(machineId);

      return;

    }

    if (amountRaw > totalFundedRaw) {

      showToast(
        `Amount exceeds total funded ($${formatUSDT(totalFundedRaw)}). Repayment cannot exceed principal.`
      );

      return;

    }

    const confirmed =
      window.confirm(
        "This is a FINAL settlement. Once submitted, this machine's financing closes permanently and cannot be repaid again. Continue?"
      );

    if (!confirmed) {
      return;
    }

    const contract =
      new ethers.Contract(
        MACHINECREDIT_ADDRESS,
        MACHINECREDIT_ABI,
        signer
      );

    const usdtContract =
      new ethers.Contract(
        USDT_ADDRESS,
        USDT_ABI,
        signer
      );

    const balance =
      await usdtContract.balanceOf(
        walletAddress
      );

    if (
      balance < amountRaw
    ) {

      showToast(
        "Insufficient USDT balance"
      );

      return;

    }

    showToast(
      "Approve USDT in MetaMask..."
    );

    const approveTx =
      await usdtContract.approve(
        MACHINECREDIT_ADDRESS,
        amountRaw
      );

    await approveTx.wait();

    showToast(
      "Confirm repayment in MetaMask..."
    );

    const tx =
      await contract.repayPrincipal(
        machineId,
        amountRaw
      );

    showToast(
      "Repayment submitted..."
    );

    await tx.wait();

    showTransactionToast(
      `Principal repaid — ${amount} USDT`,
      tx.hash
    );

    if (input) {
      input.value = "";
    }

    await loadSettlementFinancing(machineId);

    await loadMachinesFromBlockchain();

  } catch (error) {

    console.error(
      "Repay principal failed:",
      error
    );

    if (
      error?.code === 4001 ||
      error?.code === "ACTION_REJECTED"
    ) {

      showToast(
        "Transaction rejected"
      );

      return;

    }

    showToast(
      error?.shortMessage ||
      error?.reason ||
      error?.message ||
      "Repayment failed"
    );

  }

}


async function claimPrincipal(machineId) {

  try {

    if (userRole !== "lender") {

      showToast(
        "Select the lender role to claim principal"
      );

      return;

    }

    if (!signer) {
      await connectWallet();
    }

    if (!signer) {
      return;
    }

    const contract =
      new ethers.Contract(
        MACHINECREDIT_ADDRESS,
        MACHINECREDIT_ABI,
        signer
      );

    const claimable =
      await contract.getClaimablePrincipal(
        machineId,
        walletAddress
      );

    if (claimable === 0n) {

      showToast(
        "No principal available to claim"
      );

      return;

    }

    const amount =
      ethers.formatUnits(
        claimable,
        6
      );

    showToast(
      "Confirm claim in MetaMask..."
    );

    const tx =
      await contract.claimPrincipal(
        machineId
      );

    showToast(
      "Claim submitted..."
    );

    await tx.wait();

    showTransactionToast(
      `Principal claimed — ${amount} USDT`,
      tx.hash
    );

    await loadPortfolio();

  } catch (error) {

    console.error(
      "Claim principal failed:",
      error
    );

    if (
      error?.code === 4001 ||
      error?.code === "ACTION_REJECTED"
    ) {

      showToast(
        "Transaction rejected"
      );

      return;

    }

    showToast(
      error?.shortMessage ||
      error?.reason ||
      error?.message ||
      "Claim failed"
    );

  }

}

/* =========================================================
   DEPOSIT REVENUE
   ========================================================= */

async function depositRevenueFromUI() {

  try {

    if (
      userRole !== "company"
    ) {

      showToast(
        "Select the company role to deposit revenue"
      );

      return;

    }


    if (!signer) {

      await connectWallet();

    }


    if (!signer) {
      return;
    }

    const machineId = currentSettlementMachineId;

    if (!machineId) {

      showToast(
        "Select a machine first"
      );

      return;

    }


    const input =
      document.getElementById(
        "revenueDepositInput"
      );


    const amount =
      String(
        input?.value || ""
      ).trim();


    if (
      !amount ||
      Number(amount) <= 0
    ) {

      showToast(
        "Enter revenue amount"
      );

      return;

    }


    const amountRaw =
      ethers.parseUnits(
        amount,
        6
      );


    const contract =
      new ethers.Contract(
        MACHINECREDIT_ADDRESS,
        MACHINECREDIT_ABI,
        signer
      );


    const usdtContract =
      new ethers.Contract(
        USDT_ADDRESS,
        USDT_ABI,
        signer
      );


    const balance =
      await usdtContract.balanceOf(
        walletAddress
      );


    if (
      balance < amountRaw
    ) {

      showToast(
        "Insufficient USDT balance"
      );

      return;

    }


    showToast(
      "Approve USDT in MetaMask..."
    );


    const approveTx =
      await usdtContract.approve(
        MACHINECREDIT_ADDRESS,
        amountRaw
      );


    await approveTx.wait();


    showToast(
      "Confirm revenue deposit in MetaMask..."
    );


    const tx =
      await contract.depositRevenue(
        machineId,
        amountRaw
      );


    showToast(
      "Revenue deposit submitted..."
    );


    await tx.wait();


    showTransactionToast(
      `Revenue deposited — ${amount} USDT`,
      tx.hash
    );


    if (input) {
      input.value = "";
    }


    await loadMachinesFromBlockchain();

    await loadPortfolio();

  } catch (error) {

    console.error(
      "Revenue deposit failed:",
      error
    );


    if (
      error?.code === 4001 ||
      error?.code === "ACTION_REJECTED"
    ) {

      showToast(
        "Transaction rejected"
      );

      return;

    }


    showToast(
      error?.shortMessage ||
      error?.reason ||
      error?.message ||
      "Revenue deposit failed"
    );

  }

}

/* =========================================================
   SCROLL
   ========================================================= */

function scrollToMarket() {

  document
    .getElementById(
      "market"
    )
    ?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

}

/* =========================================================
   NOTIFICATIONS
   ========================================================= */

function addNotification(title, message) {

  notifications.unshift({
    id: `${Date.now()}-${Math.random()}`,
    title,
    message
  });

  notifications =
    notifications.slice(0, 20);

  renderNotifications();

}


function renderNotifications() {

  const panel =
    document.getElementById(
      "notificationPanel"
    );

  if (!panel) {
    return;
  }

  if (!notifications.length) {

    panel.innerHTML = `
      <div class="notification-head">Recent Notifications</div>
      <div class="notification-item">
        <span>No notifications yet</span>
      </div>
    `;

    return;

  }

  panel.innerHTML = `
    <div class="notification-head">Recent Notifications</div>
    ${notifications
      .map(
        note => `
          <div class="notification-item">
            <strong>${escapeHTML(note.title)}</strong>
            <span>${escapeHTML(note.message)}</span>
          </div>
        `
      )
      .join("")}
  `;

}


function setupOnchainEventListeners() {

  if (
    !provider ||
    !walletAddress ||
    !userRole
  ) {

    return;

  }

  if (eventsContract) {

    eventsContract.removeAllListeners();

  }

  eventsContract =
    new ethers.Contract(
      MACHINECREDIT_ADDRESS,
      MACHINECREDIT_ABI,
      provider
    );

  eventsContract.on(
    "InvestmentMade",
    (machineId, lender, amount) => {

      handleInvestmentMadeEvent(
        machineId
      );

    }
  );

  eventsContract.on(
    "RevenueDeposited",
    (machineId, revenue, lenderPool, companyShare) => {

      handleRevenueDepositedEvent(
        machineId,
        revenue,
        companyShare
      );

    }
  );

}

async function catchUpMissedEvents() {

  if (
    !provider ||
    !walletAddress ||
    !userRole
  ) {

    return;

  }

  try {

    const readContract =
      new ethers.Contract(
        MACHINECREDIT_ADDRESS,
        MACHINECREDIT_ABI,
        provider
      );

    const latestBlock =
      await provider.getBlockNumber();

    const syncKey =
      getSyncBlockKey(walletAddress);

    const storedBlock =
      localStorage.getItem(syncKey);

    const fromBlock =
      storedBlock
        ? Number(storedBlock) + 1
        : Math.max(latestBlock - 5000, 0);

    if (fromBlock > latestBlock) {

      return;

    }

    const processed =
      getProcessedEvents(walletAddress);

    const investmentLogs =
      await readContract.queryFilter(
        readContract.filters.InvestmentMade(),
        fromBlock,
        latestBlock
      );

    for (const log of investmentLogs) {

      const eventKey =
        `${log.transactionHash}-${log.index}`;

      if (processed.includes(eventKey)) {
        continue;
      }

      await handleInvestmentMadeEvent(
        log.args.machineId
      );

      markEventProcessed(
        walletAddress,
        eventKey
      );

    }

    const revenueLogs =
      await readContract.queryFilter(
        readContract.filters.RevenueDeposited(),
        fromBlock,
        latestBlock
      );

    for (const log of revenueLogs) {

      const eventKey =
        `${log.transactionHash}-${log.index}`;

      if (processed.includes(eventKey)) {
        continue;
      }

      await handleRevenueDepositedEvent(
        log.args.machineId,
        log.args.revenue,
        log.args.companyShare
      );

      markEventProcessed(
        walletAddress,
        eventKey
      );

    }

    localStorage.setItem(
      syncKey,
      String(latestBlock)
    );

  } catch (error) {

    console.error(
      "Failed to catch up missed events:",
      error
    );

  }

}

async function handleInvestmentMadeEvent(machineId) {

  if (userRole !== "company") {
    return;
  }

  try {

    const readContract =
      new ethers.Contract(
        MACHINECREDIT_ADDRESS,
        MACHINECREDIT_ABI,
        provider
      );

    const data =
      await readContract.getMachine(
        machineId
      );

    const owner = data[7];

    if (
      String(owner).toLowerCase() !==
      walletAddress.toLowerCase()
    ) {

      return;

    }

    const machineLabel = data[0];

    const fundedAmount =
      Number(
        ethers.formatUnits(
          data[5],
          6
        )
      );

    const targetAmount =
      Number(
        ethers.formatUnits(
          data[4],
          6
        )
      );

    const percent =
      targetAmount > 0
        ? Math.min(
            (fundedAmount / targetAmount) * 100,
            100
          )
        : 0;

    addNotification(
      `${machineLabel} received new investment`,
      `Total funded $${fundedAmount.toLocaleString()} (${percent.toFixed(0)}% of funding target)`
    );

    if (
      targetAmount > 0 &&
      fundedAmount >= targetAmount
    ) {

      addNotification(
        `${machineLabel} funding target reached`,
        `Funding target of $${targetAmount.toLocaleString()} has been fully funded.`
      );

    }

    await loadMachinesFromBlockchain();

  } catch (error) {

    console.error(
      "Failed to handle InvestmentMade event:",
      error
    );

  }

}


async function handleRevenueDepositedEvent(
  machineId,
  revenue,
  companyShare
) {

  try {

    const readContract =
      new ethers.Contract(
        MACHINECREDIT_ADDRESS,
        MACHINECREDIT_ABI,
        provider
      );

    const data =
      await readContract.getMachine(
        machineId
      );

    const owner = data[7];

    const machineLabel = data[0];


    if (
      userRole === "company" &&
      String(owner).toLowerCase() ===
        walletAddress.toLowerCase()
    ) {

      const companyShareAmount =
        Number(
          ethers.formatUnits(
            companyShare,
            6
          )
        );

      addNotification(
        "Revenue split received",
        `$${companyShareAmount.toLocaleString()} has been sent to your wallet from ${machineLabel} revenue.`
      );

    }


    if (userRole === "lender") {

      const investor =
        await readContract.getInvestor(
          machineId,
          walletAddress
        );

      const investedAmount =
        investor.amount ?? investor[0];

      const isActive =
        investor.active ?? investor[2];

      if (
        isActive &&
        BigInt(investedAmount) > 0n
      ) {

        const revenueAmount =
          Number(
            ethers.formatUnits(
              revenue,
              6
            )
          );

        addNotification(
          `${machineLabel} revenue deposited`,
          `Company deposited $${revenueAmount.toLocaleString()} revenue for ${machineLabel}.`
        );

        const pending =
          await readContract.getPendingRevenue(
            machineId,
            walletAddress
          );

        const pendingAmount =
          Number(
            ethers.formatUnits(
              pending,
              6
            )
          );

        if (pendingAmount > 0) {

          addNotification(
            "New pending revenue",
            `You have $${pendingAmount.toLocaleString()} pending revenue from ${machineLabel}.`
          );

        }

      }

      await loadPortfolio();

    }

    await loadMonthlyRevenue(true);

  } catch (error) {

    console.error(
      "Failed to handle RevenueDeposited event:",
      error
    );

  }

}


function toggleNotifications() {

  document
    .getElementById(
      "notificationPanel"
    )
    ?.classList.toggle(
      "active"
    );

}


document.addEventListener(
  "click",
  event => {

    const panel =
      document.getElementById(
        "notificationPanel"
      );


    const button =
      event.target.closest(
        ".app-icon-btn"
      );


    if (
      panel &&
      !panel.contains(
        event.target
      ) &&
      !button
    ) {

      panel.classList.remove(
        "active"
      );

    }


    const walletMenu =
      document.getElementById(
        "walletMenu"
      );


    const walletButton =
      event.target.closest(
        ".app-wallet-wrap"
      );


    if (
      walletMenu &&
      !walletMenu.contains(
        event.target
      ) &&
      !walletButton
    ) {

      walletMenu.classList.remove(
        "active"
      );

    }

  }
);

/* =========================================================
   WALLET LISTENER
   ========================================================= */

function setupWalletListeners() {

  if (
    !window.ethereum ||
    window.__machineCreditWalletListener
  ) {

    return;

  }


  window.__machineCreditWalletListener =
    true;


  window.ethereum.on(
    "accountsChanged",
    async accounts => {

      /*
        Wallet disconnected
      */

      if (
        !accounts ||
        accounts.length === 0
      ) {

        connected =
          false;

        walletAddress =
          null;

        signer =
          null;

        userRole =
          null;

        eventsContract?.removeAllListeners();

        eventsContract = null;

        notifications = [];

        updateWalletDisconnectedUI();

        applyRoleUI();

        renderEmptyPortfolio();

        renderNotifications();

        hideWalletMenu();

        showToast(
          "Wallet disconnected"
        );

        return;

      }


      /*
        Wallet switched
      */

      try {

        await ensureBotChain();


        signer =
          await provider.getSigner();


        walletAddress =
          accounts[0];


        connected =
          true;


        updateWalletUI(
          walletAddress
        );


        await initializeWalletRole(
          true
        );

        setupOnchainEventListeners();

        await catchUpMissedEvents();

        await loadPortfolio();


        showToast(
          `Wallet switched: ${walletAddress.slice(
            0,
            6
          )}...${walletAddress.slice(
            -4
          )}`
        );

      } catch (error) {

        console.error(
          "Account change failed:",
          error
        );

      }

    }
  );

}

/* =========================================================
   LANDING NAVBAR
   ========================================================= */

const landingNavbar =
  document.getElementById(
    "landingNavbar"
  );


if (landingNavbar) {

  window.addEventListener(
    "scroll",
    () => {

      landingNavbar.classList.toggle(
        "scrolled",
        window.scrollY > 8
      );

    },
    {
      passive: true
    }
  );

}

/* =========================================================
   SCROLL REVEAL
   ========================================================= */

function setupScrollReveal() {

  const elements =
    document.querySelectorAll(
      ".reveal"
    );


  if (
    !(
      "IntersectionObserver"
      in window
    )
  ) {

    elements.forEach(
      element =>
        element.classList.add(
          "is-visible"
        )
    );

    return;

  }


  const observer =
    new IntersectionObserver(
      entries => {

        entries.forEach(
          entry => {

            entry.target.classList.toggle(
              "is-visible",
              entry.isIntersecting
            );

          }
        );

      },
      {
        threshold: 0.15
      }
    );


  elements.forEach(
    element =>
      observer.observe(
        element
      )
  );

}

/* =========================================================
   NETWORK BANNER & LINKS
   ========================================================= */

function renderNetworkBanner() {

  // Hanya di app (tempat transaksi terjadi)
  if (
    !document.body.classList.contains(
      "app-page"
    )
  ) {
    return;
  }

  const banner =
    document.createElement("div");

  banner.className =
    `network-banner network-banner-${ACTIVE_NETWORK}`;

  banner.textContent =
    ACTIVE_NETWORK === "mainnet"
      ? `Hackathon MVP on ${NETWORK.chainName} · Unaudited smart contract · Use small amounts only`
      : `Hackathon MVP on ${NETWORK.chainName} · Test tokens only`;

  document.body.prepend(banner);

}

function applyNetworkLinks() {

  const footerExplorer =
    document.getElementById(
      "footerExplorerLink"
    );

  if (footerExplorer) {
    footerExplorer.href =
      `${EXPLORER_URL}/address/${MACHINECREDIT_ADDRESS}`;
  }

}

/* =========================================================
   INITIALIZATION
   ========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  async () => {

    renderNetworkBanner();

    applyNetworkLinks();

    setupWalletListeners();

    setupScrollReveal();

    renderNotifications();
    /*
      Pastikan UI dalam kondisi "belum connect"
      (Launch Robot & Portfolio hidden) sebelum
      wallet mana pun terhubung. Wallet HANYA
      connect setelah user klik Connect Wallet —
      tidak ada auto-connect / eth_accounts di sini.
    */

    updateWalletDisconnectedUI();

    applyRoleUI();

    await loadMachinesFromBlockchain();

  }
);