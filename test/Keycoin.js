const { days } = require('@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time/duration');
const { expect } = require('chai');
const { keccak256, toUtf8Bytes, parseEther, formatEther, parseUnits, formatUnits, ZeroAddress } = require('ethers');
const { ethers, upgrades, network } = require('hardhat');
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * @dev KEYCOIN token supply groups
 */
const supply = {
    reserve: 1,     // reserve
    team: 2,        // team
    public: 3,      // public sale
    liquidity: 4,   // exchanges liquidity
    uStaking: 5,    // USD staking rewards
    kStaking: 6     // KEYCOIN staking rewards
}

/**
 * @dev Exchange rate by distribution phase (1 USD => X tokens)
 */
const phaseRate = ['22222222222222000000', '18181818181818000000', '15384615384615000000', '12500000000000000000']

/**
 * @dev Roles used in-test
 */
const roles = [
    "owner",
    "pauser",
    "minter",
    "upgrader",
    "user1",
    "user2",
    "user3",
    "user4",
    "kycSigner",
];


describe('Keycoin', function () {
    let keycoin;            // KEYCOIN ERC20 Token
    let vestingWallet;      // VESTING WALLET
    let crowdsale;          // COWDSALE MANAGER
    let usdc;               // MOCK USD (test purpose only)
    let usdDecimals;       // Dynamic collateral token decimals
    let signers = {};  
    let snapshotId;     

    const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
    const PAUSER_ROLE = keccak256(toUtf8Bytes("PAUSER_ROLE"));
    const MINTER_ROLE = keccak256(toUtf8Bytes("MINTER_ROLE"));
    const UPGRADER_ROLE = keccak256(toUtf8Bytes("UPGRADER_ROLE"));

    /**
     * @dev Get a contract instance with signer connected
     * @param {*} sig Signer wallet
     * @param {*} contract Contract instance
     */
    let from = (sig, contract) => ((contract || keycoin).connect(sig));

    /**
     * @dev Sign a KYC for an account as the authorised `kycSigner` [EIP-191]
     * @param {*} userAddress the address of the customer to sign for
     * @returns {object} { deadline, signature }
     */
    async function getKycSignature(userAddress) {
        const deadline = Math.floor(Date.now() / 1000) + 3600;

        // reproduce abi.encode(user, deadline)
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const encoded = abiCoder.encode(
        ["address", "uint256"],
        [userAddress, deadline]
        );
        const structHash = ethers.keccak256(encoded);

        // sign structHash (EIP-191)
        const signature = await signers.kycSigner.signMessage(ethers.getBytes(structHash));

        return { deadline, signature };
    }

    /**
     * @dev Approve an amount of USD to spend and purchase KEYCOIN
     * @param {*} cli Wallet of spender
     * @param {*} value Value of USD to spend
     */
    async function approveAndPurchase(cli, value) {
        await from(cli, usdc).approve(crowdsale.target, value);
        const { deadline, signature } = await getKycSignature(cli.address);
        await from(cli, crowdsale).purchaseFromUsd(value, deadline, signature);  
    }

    /**
     * @dev Retrieve the datas of a supply group
     * @param {*} supplyName the name of the target supply group
     * @returns {object} SupplyGroup data
     */
    async function getSupplyGroupVesting(supplyName) {
        const sCode = await keccak256(toUtf8Bytes(supplyName));
        const supplyGroupVesting = await vestingWallet.supplyGroupVesting(sCode);

        return {
            code: sCode,
            unvested: parseInt(supplyGroupVesting[0].toString()),    // total unvested (yet-to-be-released) amount
            released: parseInt(supplyGroupVesting[1].toString()),    // total released amount
            cliff: parseInt(supplyGroupVesting[2].toString()),       // lock period in months before vesting starts
            duration: parseInt(supplyGroupVesting[3].toString()),    // vesting duration in months
            start: parseInt(supplyGroupVesting[4].toString()),       // timestamp when vesting starts
            end: parseInt(supplyGroupVesting[5].toString()),         // timestamp when vesting ends
        }
    }
    
    beforeEach(async function () {
        snapshotId = await network.provider.send("evm_snapshot");
        const _signers = await ethers.getSigners()
        signers = Object.fromEntries(
            roles.map((role, i) => [role, _signers[i]])
        );
        
        const keycoinFactory = await ethers.getContractFactory('Keycoin')
        keycoin = (await upgrades.deployProxy(keycoinFactory, [signers.owner.address, signers.pauser.address, signers.minter.address, signers.upgrader.address], {
            kind: 'uups',
            initializer: 'initialize',
        }));
        await keycoin.waitForDeployment();

        const vestingWalletFactory = await ethers.getContractFactory('KeycoinVesting');
        vestingWallet = await vestingWalletFactory.deploy(signers.owner.address, keycoin.target);
        await vestingWallet.waitForDeployment();
        await keycoin.setVestingWallet(vestingWallet.target);

        const USDCMockFactory = await ethers.getContractFactory('contracts/test/USDCMock.sol:USDCMock');
        usdc = await USDCMockFactory.deploy();
        await usdc.waitForDeployment();
        usdDecimals = parseInt(await usdc.decimals());
        const KeycoinCrowdsaleFactory = await ethers.getContractFactory('KeycoinCrowdsale');
        crowdsale = await KeycoinCrowdsaleFactory.deploy(signers.owner.address, keycoin.target, usdc.target, signers.kycSigner.address);
        await crowdsale.waitForDeployment();

    })

    afterEach(async () => {
        // Revert to the snapshot to restore original time & state
        await network.provider.send("evm_revert", [snapshotId]);
    });


    /* * *   U N I T   T E S T S   * * */
    it('should set the correct roles', async function () {
        expect(await keycoin.hasRole(DEFAULT_ADMIN_ROLE, signers.owner.address)).to.eq(true);
        expect(await keycoin.hasRole(PAUSER_ROLE, signers.pauser.address)).to.eq(true);
        expect(await keycoin.hasRole(MINTER_ROLE, signers.minter.address)).to.eq(true);
        expect(await keycoin.hasRole(UPGRADER_ROLE, signers.upgrader.address)).to.eq(true);
    })

    it('should set the correct version, name and symbol', async() => {
        expect(await keycoin.version()).to.eq('1.0.0')
        expect(await keycoin.name()).to.eq('Keycoin');
        expect(await keycoin.symbol()).to.eq('KEYCOIN')
    })

    it('should restrict update of usd collateral token address', async() => {
        await expect(
            from(signers.owner, crowdsale).setUsdContract(ZeroAddress)
        ).to.be.rejectedWith("invalid collateral address");
            
        // deploy new usd collateral
        const USDMockFactory = await ethers.getContractFactory('contracts/test/USDCMock.sol:USDCMock');
        const newCollateral = await USDMockFactory.deploy();
        await newCollateral.waitForDeployment();

        await expect(
            from(signers.user1, crowdsale).setUsdContract(newCollateral.target)
        ).to.be.revertedWithCustomError(vestingWallet, "OwnableUnauthorizedAccount")
        
        await expect(
            from(signers.owner, crowdsale).setUsdContract(newCollateral.target)
        ).to.be.fulfilled;

        expect(await crowdsale.usdContract()).to.eq(newCollateral.target);    // OwnableUnauthorizedAccount
    })

    it('should restrict update of the KYC Signer', async() => {
        await expect(
            from(signers.user1, crowdsale).setKycSigner(signers.user1.address)
        ).to.be.revertedWithCustomError(vestingWallet, "OwnableUnauthorizedAccount")

        await expect(
            from(signers.owner, crowdsale).setKycSigner(signers.user1.address)
        ).to.be.fulfilled;

        expect(
            await crowdsale.kycSigner()
        ).to.eq(signers.user1)
    })

    it('should mint tokens', async() => {
        // to.be.revertedWith // not.to.be.reverted
        const mintAmount = parseEther('1250');
        await expect(
            from(signers.pauser).mint(signers.user1.address, mintAmount, supply.public)
        ).to.be.revertedWithCustomError(keycoin, "AccessControlUnauthorizedAccount");
        expect(await keycoin.balanceOf(signers.user1.address)).to.eq('0');
        await expect(
            from(signers.minter).mint(signers.user1.address, mintAmount, 0)
        ).to.be.rejectedWith('UNKOWN_SUPPLY_GROUP');
        await expect(
            from(signers.minter).mint(signers.user1.address, mintAmount, supply.public)
        ).not.to.be.reverted;
        expect(await keycoin.balanceOf(signers.user1.address)).to.eq(mintAmount);
        expect(await keycoin.currentSupply(supply.public)).to.eq(mintAmount);
    })

    it('should not overflow the maximum supply of a group', async() => {
        const mintAmount = parseEther('36000001');
        await expect(
            from(signers.minter).mint(signers.user1.address, mintAmount, supply.public)
        ).to.be.revertedWith('SUPPLY_GROUP_OVERFLOW');
        expect(await keycoin.totalSupply()).to.eq('0');
    })

    it('should not overflow the maximum supply of all groups', async() => {
        const maxStakingGroupAmount = parseEther('108000000');
        const maxOtherSupplyGroupAmount = parseEther('36000000');
        // group 1 (reserve/cashflow)
        await expect(
            from(signers.minter).mint(signers.user1.address, maxOtherSupplyGroupAmount, supply.reserve)
        ).to.be.fulfilled;
        // group 2 (team)
        await expect(
            from(signers.minter).mint(signers.user1.address, maxOtherSupplyGroupAmount, supply.team)
        ).to.be.fulfilled;
        // group 3 (public)
        await expect(
            from(signers.minter).mint(signers.user1.address, maxOtherSupplyGroupAmount, supply.public)
        ).to.be.fulfilled;
        // group 4 (exchanges liquidity)
        await expect(
            from(signers.minter).mint(signers.user1.address, maxOtherSupplyGroupAmount, supply.liquidity)
        ).to.be.fulfilled;
        // group 5 (USD Staking)
        await expect(
            from(signers.minter).mint(signers.user1.address, maxStakingGroupAmount, supply.uStaking)
        ).to.be.fulfilled;
        // group 6 (Keycoin Staking)
        await expect(
            from(signers.minter).mint(signers.user1.address, maxStakingGroupAmount, supply.kStaking)
        ).to.be.fulfilled;

        // totalSupply check
        expect(await keycoin.totalSupply()).to.eq(parseEther('360000000'));

        // can't mint one more KEYCOIN in any group
        await expect(
            from(signers.minter).mint(signers.user1.address, parseEther("1"), supply.team)
        ).to.be.rejected;

        const cashVesting = await getSupplyGroupVesting('CASHFLOW');

        const reserveReleasableNow = await vestingWallet.releasable(await keccak256(toUtf8Bytes("CASHFLOW")), 0);
        await expect(reserveReleasableNow).to.be.above(0);

        await expect(
            from(signers.minter, vestingWallet).release(await keccak256(toUtf8Bytes("CASHFLOW")), reserveReleasableNow, signers.user2.address)
        ).to.be.revertedWithCustomError(vestingWallet, "OwnableUnauthorizedAccount")

        await expect(
            await keycoin.balanceOf(signers.user2.address)
        ).to.eq(0);

        await expect(
            from(signers.owner, vestingWallet).release(await keccak256(toUtf8Bytes("CASHFLOW")), reserveReleasableNow, signers.user2.address)
        ).to.be.fulfilled;

        await expect(
            await keycoin.balanceOf(signers.user2.address)
        ).to.eq(reserveReleasableNow);    

        const reserveReleasableAtEnd = await vestingWallet.releasable(await keccak256(toUtf8Bytes("CASHFLOW")), cashVesting.end.toString()); 
        await expect(reserveReleasableAtEnd.toString()).to.be.above(parseEther('35999900'))
        
        const teamReleasable = await vestingWallet.releasable(await keccak256(toUtf8Bytes("TEAM")), parseInt(Date.now()/1000) + days(30));
        await expect(teamReleasable.toString()).to.eq('0');

    })

    it('should be pausable', async() => {
        const mAmount = parseEther('100');
        // is unpaused
        expect(await keycoin.paused()).to.eq(false);
        // pause unallowed
        await expect(
            from(signers.minter).pause()
        ).to.be.revertedWithCustomError(keycoin, 'AccessControlUnauthorizedAccount');
        // pause allowed
        await expect(
            from(signers.pauser).pause()
        ).to.be.fulfilled;
        // is paused
        expect(await keycoin.paused()).to.eq(true);
        // mint unallowed
        await expect(
            from(signers.minter).mint(signers.user1.address, mAmount, supply.public)
        ).to.be.revertedWithCustomError(keycoin, 'EnforcedPause');
        expect(await keycoin.totalSupply()).to.eq('0');
        // unpause unallowed
        await expect(
            from(signers.minter).unpause()
        ).to.be.revertedWithCustomError(keycoin, 'AccessControlUnauthorizedAccount');
        // unpause allowed
        await expect(
            from(signers.pauser).unpause()
        ).to.be.fulfilled;
        // is unpaused
        expect(await keycoin.paused()).to.eq(false);
        // allowed mint
        await expect(
            from(signers.minter).mint(signers.user1.address, mAmount, supply.public)
        ).to.be.fulfilled;
        expect(await keycoin.totalSupply()).to.eq(mAmount);
    })

    it("should upgrade to a new version", async function () {
        // deploy new implem
        const KeycoinV2 = await ethers.getContractFactory("contracts/test/KeycoinV2.sol:KeycoinV2", signers.upgrader);
        const KeycoinV2_BAD_SIGNER = await ethers.getContractFactory("contracts/test/KeycoinV2.sol:KeycoinV2", signers.owner);
    
        // upgrade
        try {
            (await upgrades.upgradeProxy(keycoin, KeycoinV2_BAD_SIGNER)).to.be.revertedWithCustomError(keycoin, "AccessControlUnauthorizedAccount");
        }catch(e) {
            expect(e?.toString()).to.contain('AccessControlUnauthorizedAccount')
        }    
        const keycoinV2 = await upgrades.upgradeProxy(keycoin, KeycoinV2);
    
        // check proxy address is the same
        expect(await keycoinV2.getAddress()).to.eq(await keycoin.getAddress());

        keycoin = keycoinV2;
    
        // check already stored data did not change
        expect(await keycoin.hasRole(DEFAULT_ADMIN_ROLE, signers.owner.address)).to.eq(true);
    
        // check that a new function is available
        expect(await keycoin.version()).to.eq("2.0.0");
        expect(await keycoin.v2Storage()).to.eq(0);
        await expect(
            from(signers.owner).changeV2Storage(2)
        ).to.be.fulfilled;
        expect(await keycoin.v2Storage()).to.eq(2); 

    });

    it('should be able to distribute KEYCOIN tokens from owner-withdrawable USD', async() => {
        const client1 = signers.user1;
        const client2 = signers.user2;
        // give USD to clients
        await usdc.mint(client1.address, parseUnits('1000', usdDecimals));
        // open KEYCOIN crowdsale
        // only minter
        await expect(from(signers.owner).mintCrowdsaleSupplyAndOpen(crowdsale.target)).to.be.revertedWithCustomError(keycoin, 'AccessControlUnauthorizedAccount');
        expect(await crowdsale.crowdsaleIsOpened()).to.be.false;

        // ok
        await expect(from(signers.minter).mintCrowdsaleSupplyAndOpen(crowdsale.target)).not.to.be.rejected;
        expect(await crowdsale.crowdsaleIsOpened()).to.be.true;

        // crowdsale already opened
        await expect(from(signers.minter).mintCrowdsaleSupplyAndOpen(crowdsale.target)).to.be.rejectedWith('CROWDSALE ALREADY OPENED');
    
        const bal = (await keycoin.balanceOf(crowdsale.target)).toString();
        await expect(bal).to.eq(await parseEther('36000000').toString());
        // client1 buys KEYCOIN in phase 1
        await expect(await usdc.balanceOf(client1.address)).to.eq(parseUnits('1000', usdDecimals));
        const quote1 = await crowdsale.quoteFromUsd(parseUnits('100', usdDecimals));
        await expect(quote1[0]).to.eq('2222222222222200000000');

        /// client1 spends 100 usdc for KEYCOIN
        await expect(approveAndPurchase(client1, parseUnits('100', usdDecimals))).not.to.be.rejected;

        expect(await keycoin.balanceOf(client1.address)).to.eq(quote1[0]);
        expect((await crowdsale.currentPricePolicy())[1]).to.eq(phaseRate[0]);
        expect((await crowdsale.currentPricePolicy())[2]).to.eq(quote1[0]);
        expect(await crowdsale.totalSold()).to.eq(quote1[0]);
        expect(await usdc.balanceOf(crowdsale.target)).to.eq(parseUnits('100', usdDecimals));

        await expect(from(signers.user1, crowdsale).withdraw(parseUnits('65', usdDecimals), signers.owner.address)).to.be.revertedWithCustomError(crowdsale, 'OwnableUnauthorizedAccount');
        await expect(from(signers.owner, crowdsale).withdraw(parseUnits('65', usdDecimals), signers.owner.address)).to.be.revertedWith('EXCEEDS 20% LIMIT');
        
        // sell KEYCOIN to reach soft cap
        await usdc.mint(client2.address, parseUnits('150000', usdDecimals));
        await expect(approveAndPurchase(client2, parseUnits('150000', usdDecimals))).not.to.be.rejected;

        // ok
        await expect(from(signers.owner, crowdsale).withdraw(parseUnits('65', usdDecimals), signers.owner.address)).to.be.fulfilled;
        
        expect(await usdc.balanceOf(signers.owner.address)).to.eq(parseUnits('65', usdDecimals));
        expect(await usdc.balanceOf(crowdsale.target)).to.eq(parseUnits('150035', usdDecimals));
    })

    it('should respect the crowdsale schedule by sold supply', async() => {
        const client1 = signers.user1;
        const client2 = signers.user2;

        const tenM = parseUnits("2319000", usdDecimals); // max 2320000 $
        
        // give USD to clients
        await usdc.mint(client1.address, tenM);
        await usdc.mint(client2.address, tenM);
        // await usdc.mint(client4.address, tenM);

        // transfer supply & open crowdsale
        await from(signers.minter).mintCrowdsaleSupplyAndOpen(crowdsale.target)

        await expect(approveAndPurchase(client1, tenM)).not.to.be.rejected;
        
        await expect(approveAndPurchase(client2, tenM)).not.to.be.rejected;

        await expect(approveAndPurchase(client2, tenM)).to.be.rejectedWith('SOLD OUT');

    })
    

    it('should respect the crowdsale schedule by time', async() => {
        const client1 = signers.user1;
        const client2 = signers.user2;
        const client3 = signers.user3;
        const client4 = signers.user3;

        const bal = parseUnits("1000000", usdDecimals);
        const val = parseUnits("100000", usdDecimals); 
        
        // give USD to clients
        await usdc.mint(client1.address, bal);
        await usdc.mint(client2.address, bal);
        await usdc.mint(client3.address, bal);
        await usdc.mint(client4.address, bal);

        // transfer supply & open crowdsale
        await from(signers.minter).mintCrowdsaleSupplyAndOpen(crowdsale.target)

        await expect(approveAndPurchase(client1, val)).not.to.be.rejected;
        const c1Bal = await keycoin.balanceOf(client1.address);
        const pp = await crowdsale.currentPricePolicy();

        // goto phase 2
        await time.increaseTo(parseInt(pp[3])+10);
        await expect(approveAndPurchase(client2, val)).not.to.be.rejected;
        const pp2 = await crowdsale.currentPricePolicy();

        expect(pp2[1]).to.eq(phaseRate[1]);

        const c2Bal = await keycoin.balanceOf(client2.address);
        expect(parseInt(c1Bal)).to.be.above(parseInt(c2Bal));

        // goto phase 3
        await time.increaseTo(parseInt(pp2[3])+10);
        await expect(approveAndPurchase(client3, val)).not.to.be.rejected;
        const pp3 = await crowdsale.currentPricePolicy();
        expect(pp3[1]).to.eq(phaseRate[2]);

        // goto phase 4
        await time.increaseTo(parseInt(pp3[3])+10);
        await expect(approveAndPurchase(client4, val)).not.to.be.rejected;
        const pp4 = await crowdsale.currentPricePolicy();
        expect(pp4[1]).to.eq(phaseRate[3]);

        // goto crowdsale end
        await time.increaseTo(parseInt(pp4[3])+10);
        // crowdsale ended
        await expect(approveAndPurchase(client1, val)).to.be.rejectedWith('SOLD OUT');

        const tSold = (await Promise.all(phaseRate.map(r => (100000 * parseFloat(formatEther(r)))))).reduce((a, b) => (a + b))
        expect(await crowdsale.totalSold()).to.eq(parseEther(tSold.toString()));
    })

    it('should be possible for the owner to pause the crowdsale anytime', async() => {
        const client1 = signers.user1;
        const val = parseUnits("2500", usdDecimals);         
        await usdc.mint(client1.address, val);
        await from(signers.minter).mintCrowdsaleSupplyAndOpen(crowdsale.target);
        await expect(await crowdsale.crowdsaleIsOpened()).to.be.true;
        // pause
        await expect(from(signers.user2, crowdsale).pauseCrowdsale()).to.be.revertedWithCustomError(crowdsale, "OwnableUnauthorizedAccount");    // onlyOwner
        await expect(from(signers.owner, crowdsale).pauseCrowdsale()).to.be.fulfilled;
        await expect(await crowdsale.crowdsaleIsOpened()).to.be.false;
        await expect(approveAndPurchase(client1, val)).to.be.rejectedWith('CROWDSALE-CLOSED');
        // unpause
        await expect(from(signers.user2, crowdsale).unpauseCrowdsale()).to.be.revertedWithCustomError(crowdsale, "OwnableUnauthorizedAccount");    // onlyOwner
        await expect(from(signers.owner, crowdsale).unpauseCrowdsale()).to.be.fulfilled;
        await expect(await crowdsale.crowdsaleIsOpened()).to.be.true;
        await expect(approveAndPurchase(client1, val)).not.to.be.rejected;;

    })

    it('should execute "closeCrowdsale_sendToDao_burnUnsold" as expected', async() => {
        const client1 = signers.user1;
        const client2 = signers.user2;
        const daoWallet = signers.user3;

        const val = parseUnits("1150000", usdDecimals); 
        
        // give USD to clients
        await usdc.mint(client1.address, val);
        await usdc.mint(client2.address, val);
        
        await expect(from(signers.minter).mintCrowdsaleSupplyAndOpen(crowdsale.target)).not.to.be.rejected;
        await expect(approveAndPurchase(client1, val)).not.to.be.rejected;

        // can't close crowdsale before the end of last phase or hardcap reached
        await expect(from(signers.owner, crowdsale).closeCrowdsale_sendToDao_burnUnsold(daoWallet.address)).to.be.rejectedWith('CROWDSALE ONGOING');

        await expect(approveAndPurchase(client2, val)).not.to.be.rejected;

        const cBal = await keycoin.balanceOf(crowdsale.target);
        const pp = await crowdsale.currentPricePolicy();
        await time.increaseTo(parseInt(pp[3])+10);

        await expect(from(signers.owner, crowdsale).closeCrowdsale_sendToDao_burnUnsold(daoWallet.address)).to.be.fulfilled;

        expect(await crowdsale.crowdsaleIsOpened()).to.be.false;

        expect(await keycoin.balanceOf(crowdsale.target)).to.eq('0');
        const daoSupBal = await parseEther((parseInt(await formatEther(cBal)) / 2).toString());;
        expect(await keycoin.balanceOf(daoWallet.address)).to.eq(daoSupBal);
        
    })

    it('should be able to delay the crowdsale last period end', async() => {
        const client1 = signers.user1;
        const client2 = signers.user2;
        await usdc.mint(client1.address, parseUnits("100000", usdDecimals));
        await usdc.mint(client2.address, parseUnits("100000", usdDecimals));

        await expect(from(signers.minter).mintCrowdsaleSupplyAndOpen(crowdsale.target)).not.to.be.rejected;

        await expect(approveAndPurchase(client1, parseUnits('1500', usdDecimals))).not.to.be.rejected;

        // goto crowdsale end
        const lastSchedule = await crowdsale.schedule('15');
        const crowdsaleEndUnix = parseInt(lastSchedule) + 10; 
        await time.increaseTo(crowdsaleEndUnix);

        // CROWDSALE-CLOSED
        await expect(approveAndPurchase(client2, parseUnits('1000', usdDecimals))).to.be.rejectedWith('SOLD OUT');

        // delay crowdsale
        const newCrowdsaleEndUnix = crowdsaleEndUnix + (3600*24*30);  // 1h * 24 * 30 = 1 month
        await expect(from(signers.user3, crowdsale).delayCrowdsale(newCrowdsaleEndUnix)).to.be.revertedWithCustomError(crowdsale, "OwnableUnauthorizedAccount")
        await expect(from(signers.owner, crowdsale).delayCrowdsale(newCrowdsaleEndUnix)).to.be.fulfilled;

        expect(await crowdsale.crowdsaleIsOpened()).to.be.true;
        await expect(approveAndPurchase(client2, parseUnits('1000', usdDecimals))).to.be.fulfilled;

        await expect(await crowdsale.usdAvailSupply()).to.eq(parseUnits('2500', usdDecimals));


    })

    it('should refund 80% after end of crowdsale if softcap is not reached', async() => {
        const client1 = signers.user1;
        const client2 = signers.user2;
        
        // give USD to clients
        await usdc.mint(client1.address, parseUnits("100000", usdDecimals));
        await usdc.mint(client2.address, parseUnits("100000", usdDecimals));
    
        // open crowdsale
        await expect(from(signers.minter).mintCrowdsaleSupplyAndOpen(crowdsale.target)).not.to.be.rejected;
    
        // sell below soft-cap (140k$)
        await expect(approveAndPurchase(client1, parseUnits('100000', usdDecimals))).not.to.be.rejected;
        await expect(approveAndPurchase(client2, parseUnits('40000', usdDecimals))).not.to.be.rejected;
    
        // refund impossible before end of last schedule
        await expect(from(client1, crowdsale).refundMe()).to.be.rejectedWith("CROWDSALE ONGOING");
    
        // goto crowdsale end
        const lastSchedule = await crowdsale.schedule('15');
        const crowdsaleEndUnix = parseInt(lastSchedule) + 10; 
        await time.increaseTo(crowdsaleEndUnix);
    
        // owner tries to closeCrowdsale_sendToDao_burnUnsold => failed   
        await expect(from(signers.owner, crowdsale).closeCrowdsale_sendToDao_burnUnsold(signers.user4.address))
            .to.be.rejectedWith('SOFTCAP UNREACHED');
        
        // non-clients can't be refunded
        await expect(from(signers.user3, crowdsale).refundMe()).to.be.rejectedWith("NO PURCHASE");  // non-client
    
        // total deposits still inside contract before refunds
        expect(await usdc.balanceOf(crowdsale.target)).to.eq(parseUnits('140000', usdDecimals));
    
        // refund client 1 (100k deposit → 80k refund)
        expect(await usdc.balanceOf(client1.address)).to.eq(parseUnits('0', usdDecimals));
        await expect(from(client1, crowdsale).refundMe()).not.to.be.rejected;
        expect(await usdc.balanceOf(client1.address)).to.eq(parseUnits('80000', usdDecimals));
    
        // contract now holds 140k - 80k = 60k
        expect(await usdc.balanceOf(crowdsale.target)).to.eq(parseUnits('60000', usdDecimals));
    
        // refund client 2 (40k deposit → 32k refund)
        expect(await usdc.balanceOf(client2.address)).to.eq(parseUnits('60000', usdDecimals));
        await expect(from(client2, crowdsale).refundMe()).not.to.be.rejected;
        expect(await usdc.balanceOf(client2.address)).to.eq(parseUnits('92000', usdDecimals));
    
        // contract now holds 60k - 32k = 28k (20% retained)
        expect(await usdc.balanceOf(crowdsale.target)).to.eq(parseUnits('28000', usdDecimals));
    
        // check that clients can't be refunded more than once
        await expect(from(client1, crowdsale).refundMe()).to.be.rejectedWith("NO PURCHASE");        // already refunded
    });

    it('should be able to release vested tokens according to the schedule', async() => {
        const maxVestingGroupAmount = parseEther('36000000');

        // mint all reserve/cashflow supply
        await expect(
            from(signers.minter).mint(signers.user1.address, maxVestingGroupAmount, supply.reserve)
        ).to.be.fulfilled;
        // mint all team supply
        await expect(
            from(signers.minter).mint(signers.user1.address, maxVestingGroupAmount, supply.team)
        ).to.be.fulfilled;

        const teamVesting = await getSupplyGroupVesting("TEAM");

        const oneMonth = parseInt(days(365) / 12);
        const afterCliffDate = teamVesting.start + (teamVesting.cliff * oneMonth);
     
        // releasable after one month
        expect(
            (await vestingWallet.releasable(teamVesting.code, afterCliffDate+oneMonth)).toString()
        ).to.eq('900000000000000000000000');

        // try to release after one month
        await time.increaseTo(afterCliffDate+oneMonth); 
        await from(signers.owner, vestingWallet).release(teamVesting.code, parseEther("400000"), signers.user1.address);   
        expect(
            (await keycoin.balanceOf(signers.user1.address)).toString()
        ).to.eq('400000000000000000000000');
        // releasable should be > 500000*10**18
        expect(
            (await vestingWallet.releasable(teamVesting.code, afterCliffDate+oneMonth)).toString()
        ).to.eq('500000000000000000000000');

        // go one more month further
        await time.increaseTo(afterCliffDate+(oneMonth*2)); 
        expect(
            (await vestingWallet.releasable(teamVesting.code, 0)).toString()
        ).to.eq('1400000000000000000000000');
        
    })

    
}) 