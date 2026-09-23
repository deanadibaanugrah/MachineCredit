// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(
        address to,
        uint256 amount
    ) external returns (bool);

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool);

    function balanceOf(
        address account
    ) external view returns (uint256);

    function allowance(
        address owner,
        address spender
    ) external view returns (uint256);

    function approve(
        address spender,
        uint256 amount
    ) external returns (bool);
}


contract MachineCredit {

    // =========================================================
    // CONFIG
    // =========================================================

    // BOT Chain Testnet USDT
    address public constant USDT =
        0x75edC9335175Fc0552D51D48439F229c10420fe3;

    uint256 public constant USDT_DECIMALS = 6;

    // Precision untuk per-share accounting
    uint256 private constant PRECISION = 1e18;


    // =========================================================
    // MACHINE
    // =========================================================

    struct Machine {
        string machineId;
        string name;

        uint256 performanceScore;
        uint256 monthlyRevenue;

        // Semua nominal USDT menggunakan 6 decimals
        uint256 fundingTarget;
        uint256 totalFunded;

        // Contoh: 20 = 20%
        uint256 revenueSharePercent;

        address owner;

        bool active;
    }

    mapping(uint256 => Machine) public machines;

    uint256 public machineCount;


    // =========================================================
    // INVESTOR
    // =========================================================

    struct Investor {
        uint256 amount;

        // Accumulated revenue yang sudah diperhitungkan
        uint256 rewardDebt;

        // Total USDT yang sudah diterima investor
        uint256 totalEarned;

        bool active;
    }

    // machineId => lender => Investor
    mapping(
        uint256 => mapping(address => Investor)
    ) public investors;


    // machineId => total investor count
    mapping(uint256 => uint256) public investorCount;


    // =========================================================
    // REVENUE ACCOUNTING
    // =========================================================

    // Total lender pool yang pernah masuk
    mapping(uint256 => uint256)
        public totalLenderRevenue;

    // Revenue per 1 USDT invested
    mapping(uint256 => uint256)
        public accumulatedRevenuePerShare;


    // =========================================================
    // FINANCING LIFECYCLE (BARU)
    // =========================================================
    //
    // Open       : financing berjalan (fundraising / machine beroperasi)
    // Completed  : principal dikembalikan penuh (final)
    // Defaulted  : principal dikembalikan sebagian (final)
    //
    // Repayment hanya bisa dilakukan SEKALI sebagai final settlement.
    // Setelah itu status tidak bisa diubah lagi, sehingga angka
    // principal loss tidak bisa dimanipulasi.
    // =========================================================

    enum FinancingStatus {
        Open,
        Completed,
        Defaulted
    }

    // machineId => status
    mapping(uint256 => FinancingStatus)
        public financingStatus;

    // machineId => total principal yang sudah di-withdraw company
    mapping(uint256 => uint256)
        public totalWithdrawn;

    // machineId => principal yang dikembalikan company (final)
    mapping(uint256 => uint256)
        public principalRepaid;

    // machineId => lender => principal yang sudah di-claim
    mapping(
        uint256 => mapping(address => uint256)
    ) public principalClaimed;


    // =========================================================
    // REENTRANCY GUARD (dipakai fungsi baru)
    // =========================================================

    uint256 private _locked = 1;

    modifier nonReentrant() {
        require(_locked == 1, "Reentrancy");
        _locked = 2;
        _;
        _locked = 1;
    }


    // =========================================================
    // EVENTS
    // =========================================================

    event MachineRegistered(
        uint256 indexed machineId,
        string externalMachineId,
        string name,
        address indexed owner,
        uint256 fundingTarget,
        uint256 revenueSharePercent
    );

    event InvestmentMade(
        uint256 indexed machineId,
        address indexed lender,
        uint256 amount
    );

    event RevenueDeposited(
        uint256 indexed machineId,
        uint256 revenue,
        uint256 lenderPool,
        uint256 companyShare
    );

    event RevenueClaimed(
        uint256 indexed machineId,
        address indexed lender,
        uint256 amount
    );

    // --- BARU ---

    event FundingWithdrawn(
        uint256 indexed machineId,
        address indexed owner,
        uint256 amount
    );

    event PrincipalRepaid(
        uint256 indexed machineId,
        uint256 amount,
        uint256 principalLoss,
        FinancingStatus status
    );

    event PrincipalClaimed(
        uint256 indexed machineId,
        address indexed lender,
        uint256 amount
    );


    // =========================================================
    // MODIFIER
    // =========================================================

    modifier onlyMachineOwner(
        uint256 _machineId
    ) {
        require(
            machines[_machineId].owner == msg.sender,
            "Not machine owner"
        );

        _;
    }


    // =========================================================
    // REGISTER MACHINE
    // =========================================================

    function registerMachine(
        string memory _machineId,
        string memory _name,
        uint256 _performanceScore,
        uint256 _monthlyRevenue,
        uint256 _fundingTarget,
        uint256 _revenueSharePercent
    ) external {

        require(
            _performanceScore <= 100,
            "Score must be 0-100"
        );

        require(
            _fundingTarget > 0,
            "Funding target required"
        );

        require(
            _revenueSharePercent > 0 &&
            _revenueSharePercent <= 100,
            "Invalid revenue share"
        );

        machineCount++;

        machines[machineCount] = Machine({
            machineId: _machineId,
            name: _name,
            performanceScore: _performanceScore,
            monthlyRevenue: _monthlyRevenue,
            fundingTarget: _fundingTarget,
            totalFunded: 0,
            revenueSharePercent: _revenueSharePercent,
            owner: msg.sender,
            active: true
        });

        emit MachineRegistered(
            machineCount,
            _machineId,
            _name,
            msg.sender,
            _fundingTarget,
            _revenueSharePercent
        );
    }


    // =========================================================
    // INVEST
    // =========================================================

    function invest(
        uint256 _machineId,
        uint256 _amount
    ) external {

        Machine storage machine = machines[_machineId];

        require(
            _machineId > 0 &&
            _machineId <= machineCount,
            "Invalid machine"
        );

        require(
            machine.active,
            "Machine inactive"
        );

        require(
            msg.sender != machine.owner,
            "Owner cannot invest"
        );

        require(
            _amount > 0,
            "Investment required"
        );

        require(
            machine.totalFunded + _amount
                <= machine.fundingTarget,
            "Funding target exceeded"
        );

        Investor storage investor =
            investors[_machineId][msg.sender];

        // Hitung pending revenue sebelum investment baru
        uint256 oldAccumulated =
            (
                investor.amount *
                accumulatedRevenuePerShare[_machineId]
            ) / PRECISION;

        uint256 pendingBefore =
            oldAccumulated - investor.rewardDebt;

        // Investor baru
        if (investor.amount == 0) {
            investorCount[_machineId]++;
        }

        // Transfer USDT dari lender
        bool success = IERC20(USDT).transferFrom(
            msg.sender,
            address(this),
            _amount
        );

        require(
            success,
            "USDT transfer failed"
        );

        // Tambahkan investment
        investor.amount += _amount;

        machine.totalFunded += _amount;

        // Investment baru tidak mendapat revenue masa lalu
        uint256 newAccumulated =
            (
                investor.amount *
                accumulatedRevenuePerShare[_machineId]
            ) / PRECISION;

        investor.rewardDebt =
            newAccumulated - pendingBefore;

        investor.active = true;

        emit InvestmentMade(
            _machineId,
            msg.sender,
            _amount
        );
    }


    // =========================================================
    // WITHDRAW FUNDING (BARU)
    // =========================================================
    //
    // Company menarik funding yang sudah terkumpul.
    //
    // availableToWithdraw = totalFunded - totalWithdrawn
    //
    // totalWithdrawn diperbarui SEBELUM transfer, sehingga
    // tidak mungkin withdraw dua kali untuk dana yang sama.
    // Hanya principal yang bisa ditarik; revenue lender yang
    // belum di-claim tidak tersentuh.
    // =========================================================

    function withdrawFunding(
        uint256 _machineId
    )
        external
        onlyMachineOwner(_machineId)
        nonReentrant
    {

        Machine storage machine =
            machines[_machineId];

        require(
            machine.active,
            "Machine inactive"
        );

        require(
            financingStatus[_machineId] ==
                FinancingStatus.Open,
            "Financing closed"
        );

        uint256 available =
            machine.totalFunded -
            totalWithdrawn[_machineId];

        require(
            available > 0,
            "Nothing to withdraw"
        );

        totalWithdrawn[_machineId] += available;

        bool success =
            IERC20(USDT).transfer(
                machine.owner,
                available
            );

        require(
            success,
            "Withdraw failed"
        );

        emit FundingWithdrawn(
            _machineId,
            machine.owner,
            available
        );
    }


    // =========================================================
    // DEPOSIT REVENUE
    // =========================================================
    //
    // Untuk MVP:
    //
    // Company / backend oracle
    //      ↓
    // depositRevenue()
    //
    // Revenue masuk ke smart contract, lalu dibagi antara
    // Company dan Investor Pool sesuai revenueSharePercent
    // (proporsional terhadap totalFunded / fundingTarget).
    //
    // Investor pool dicatat menggunakan
    // accumulatedRevenuePerShare.
    // =========================================================

    function depositRevenue(
        uint256 _machineId,
        uint256 _amount
    )
        external
        onlyMachineOwner(_machineId)
    {

        Machine storage machine =
            machines[_machineId];

        require(
            machine.active,
            "Machine inactive"
        );

        require(
            machine.totalFunded > 0,
            "No investors"
        );

        require(
            _amount > 0,
            "Revenue required"
        );


        // Ambil USDT dari company
        bool success = IERC20(USDT).transferFrom(
            msg.sender,
            address(this),
            _amount
        );

        require(
            success,
            "USDT transfer failed"
        );


        // =====================================================
        // SPLIT
        // =====================================================

        uint256 lenderPool =
            (
                _amount *
                machine.revenueSharePercent *
                machine.totalFunded
            ) /
            (
                machine.fundingTarget * 100
            );

        uint256 companyShare =
            _amount - lenderPool;


        // =====================================================
        // COMPANY PAYOUT
        // =====================================================

        if (companyShare > 0) {

            bool companyPaid =
                IERC20(USDT).transfer(
                    machine.owner,
                    companyShare
                );

            require(
                companyPaid,
                "Company payout failed"
            );
        }


        // =====================================================
        // INVESTOR POOL
        // =====================================================

        totalLenderRevenue[_machineId]
            += lenderPool;


        accumulatedRevenuePerShare[_machineId]
            += (
                lenderPool * PRECISION
            ) / machine.totalFunded;


        emit RevenueDeposited(
            _machineId,
            _amount,
            lenderPool,
            companyShare
        );
    }


    // =========================================================
    // CLAIM REVENUE
    // =========================================================

    function claimRevenue(
        uint256 _machineId
    ) external {

        _claim(
            _machineId,
            msg.sender
        );
    }


    function _claim(
        uint256 _machineId,
        address _lender
    ) internal {

        Investor storage investor =
            investors[_machineId][_lender];


        require(
            investor.amount > 0,
            "No investment"
        );


        uint256 accumulated =
            (
                investor.amount *
                accumulatedRevenuePerShare[_machineId]
            ) / PRECISION;


        uint256 pending =
            accumulated -
            investor.rewardDebt;


        if (pending > 0) {

            investor.rewardDebt =
                accumulated;

            investor.totalEarned += pending;


            bool success =
                IERC20(USDT).transfer(
                    _lender,
                    pending
                );

            require(
                success,
                "Lender payout failed"
            );


            emit RevenueClaimed(
                _machineId,
                _lender,
                pending
            );
        }
        else {

            // Tetap update debt supaya
            // accounting konsisten.
            investor.rewardDebt =
                accumulated;
        }
    }


    // =========================================================
    // REPAY PRINCIPAL (BARU)
    // =========================================================
    //
    // Final settlement, HANYA SEKALI per machine.
    //
    // - Company harus sudah withdraw seluruh funding.
    // - _amount = principal yang dikembalikan (1..totalFunded).
    // - _amount == totalFunded  -> status Completed
    // - _amount <  totalFunded  -> status Defaulted
    //   (principal loss = totalFunded - _amount)
    //
    // Setelah settlement machine.active = false, sehingga
    // invest() dan depositRevenue() otomatis tertutup.
    // Lender tetap bisa claimRevenue() dan claimPrincipal().
    // =========================================================

    function repayPrincipal(
        uint256 _machineId,
        uint256 _amount
    )
        external
        onlyMachineOwner(_machineId)
        nonReentrant
    {

        Machine storage machine =
            machines[_machineId];

        require(
            financingStatus[_machineId] ==
                FinancingStatus.Open,
            "Already settled"
        );

        require(
            machine.totalFunded > 0,
            "No investors"
        );

        require(
            totalWithdrawn[_machineId] ==
                machine.totalFunded,
            "Withdraw all funding first"
        );

        require(
            _amount > 0 &&
            _amount <= machine.totalFunded,
            "Invalid repayment"
        );


        principalRepaid[_machineId] = _amount;

        machine.active = false;

        FinancingStatus status =
            _amount == machine.totalFunded
                ? FinancingStatus.Completed
                : FinancingStatus.Defaulted;

        financingStatus[_machineId] = status;


        bool success =
            IERC20(USDT).transferFrom(
                msg.sender,
                address(this),
                _amount
            );

        require(
            success,
            "USDT transfer failed"
        );


        emit PrincipalRepaid(
            _machineId,
            _amount,
            machine.totalFunded - _amount,
            status
        );
    }


    // =========================================================
    // CLAIM PRINCIPAL (BARU)
    // =========================================================
    //
    // Bagian lender = invested * principalRepaid / totalFunded
    // Pembulatan ke bawah: total claim tidak pernah melebihi
    // principalRepaid (sisa debu <1 unit USDT tetap di contract).
    // =========================================================

    function claimPrincipal(
        uint256 _machineId
    )
        external
        nonReentrant
    {

        require(
            financingStatus[_machineId] !=
                FinancingStatus.Open,
            "Principal not repaid yet"
        );

        uint256 claimable =
            getClaimablePrincipal(
                _machineId,
                msg.sender
            );

        require(
            claimable > 0,
            "Nothing to claim"
        );

        principalClaimed[_machineId][msg.sender]
            += claimable;

        bool success =
            IERC20(USDT).transfer(
                msg.sender,
                claimable
            );

        require(
            success,
            "Principal payout failed"
        );

        emit PrincipalClaimed(
            _machineId,
            msg.sender,
            claimable
        );
    }


    // =========================================================
    // VIEW FUNCTIONS
    // =========================================================

    function getMachine(
        uint256 _machineId
    )
        external
        view
        returns (
            string memory,
            string memory,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            address,
            bool
        )
    {

        Machine memory machine =
            machines[_machineId];

        return (
            machine.machineId,
            machine.name,
            machine.performanceScore,
            machine.monthlyRevenue,
            machine.fundingTarget,
            machine.totalFunded,
            machine.revenueSharePercent,
            machine.owner,
            machine.active
        );
    }


    function getInvestor(
        uint256 _machineId,
        address _lender
    )
        external
        view
        returns (
            uint256 amount,
            uint256 totalEarned,
            bool active
        )
    {

        Investor memory investor =
            investors[_machineId][_lender];

        return (
            investor.amount,
            investor.totalEarned,
            investor.active
        );
    }


    function getPendingRevenue(
        uint256 _machineId,
        address _lender
    )
        public
        view
        returns (uint256)
    {

        Investor memory investor =
            investors[_machineId][_lender];

        if (investor.amount == 0) {
            return 0;
        }


        uint256 accumulated =
            (
                investor.amount *
                accumulatedRevenuePerShare[_machineId]
            ) / PRECISION;


        return (
            accumulated -
            investor.rewardDebt
        );
    }


    function getUSDTBalance()
        external
        view
        returns (uint256)
    {
        return IERC20(USDT).balanceOf(
            address(this)
        );
    }


    // --- BARU ---

    function getFinancing(
        uint256 _machineId
    )
        external
        view
        returns (
            uint256 totalFunded,
            uint256 withdrawn,
            uint256 availableToWithdraw,
            uint256 repaid,
            uint256 principalLoss,
            FinancingStatus status
        )
    {

        Machine storage machine =
            machines[_machineId];

        status =
            financingStatus[_machineId];

        totalFunded =
            machine.totalFunded;

        withdrawn =
            totalWithdrawn[_machineId];

        availableToWithdraw =
            status == FinancingStatus.Open
                ? totalFunded - withdrawn
                : 0;

        repaid =
            principalRepaid[_machineId];

        principalLoss =
            status == FinancingStatus.Defaulted
                ? totalFunded - repaid
                : 0;
    }


    // Principal yang menjadi hak lender (sudah + belum di-claim).
    // 0 selama financing masih Open.
    function getPrincipalEntitlement(
        uint256 _machineId,
        address _lender
    )
        public
        view
        returns (uint256)
    {

        if (
            financingStatus[_machineId] ==
                FinancingStatus.Open
        ) {
            return 0;
        }

        uint256 funded =
            machines[_machineId].totalFunded;

        if (funded == 0) {
            return 0;
        }

        return (
            investors[_machineId][_lender].amount *
            principalRepaid[_machineId]
        ) / funded;
    }


    function getClaimablePrincipal(
        uint256 _machineId,
        address _lender
    )
        public
        view
        returns (uint256)
    {

        return
            getPrincipalEntitlement(
                _machineId,
                _lender
            ) -
            principalClaimed[_machineId][_lender];
    }
}
