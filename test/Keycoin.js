const { days } = require('@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time/duration');
const { expect } = require('chai');
const { keccak256, toUtf8Bytes, parseEther, formatEther, parseUnits, formatUnits } = require('ethers');
const { ethers, upgrades } = require('hardhat');
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const supply = {
    reserve: 1,
    team: 2,
    public: 3,
    liquidity: 4,
    uStaking: 5,
    kStaking: 6
}

const phaseRate = ['22222222222222000000', '18181818181818000000', '15384615384615000000', '12500000000000000000']



describe('Keycoin', function () {
    let keycoin;            // KEYCOIN ERC20 Token
    let vestingWallet;      // VESTING WALLET
    let crowdsale;          // COWDSALE MANAGER
    let usdc;               // MOCK USDC (test purpose only)
    let usdcDecimals;       // Dynamic collateral token decimals
    let signers = {};       

    const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
    const PAUSER_ROLE = keccak256(toUtf8Bytes("PAUSER_ROLE"));
    const MINTER_ROLE = keccak256(toUtf8Bytes("MINTER_ROLE"));
    const UPGRADER_ROLE = keccak256(toUtf8Bytes("UPGRADER_ROLE"));

    let from = (sig, contract) => ((contract || keycoin).connect(sig));

    async function approveAndPurchase(signer, value) {
        await from(signer, usdc).approve(crowdsale.target, value);
        await from(signer, crowdsale).purchaseFromUsdc(value);
        //console.log(formatUnits(value, usdcDecimals), '$ approved, some keycoins have been purchased !');
    }
    
    beforeEach(async function () {
        const _signers = await ethers.getSigners()
        signers.owner = _signers[0];
        signers.pauser = _signers[1];
        signers.minter = _signers[2];
        signers.upgrader = _signers[3];
        signers.user1 = _signers[4];
        signers.user2 = _signers[5];
        signers.user3 = _signers[6];
        signers.user4 = _signers[7];
        
        const keycoinFactory = await ethers.getContractFactory('Keycoin')
        keycoin = (await upgrades.deployProxy(keycoinFactory, [signers.owner.address, signers.pauser.address, signers.minter.address, signers.upgrader.address], {
            kind: 'uups',
            initializer: 'initialize',
        }));
        await keycoin.waitForDeployment();

        const vestingWalletFactory = await ethers.getContractFactory('KeycoinVesting');
        vestingWallet = await vestingWalletFactory.deploy(signers.owner.address, keycoin.target);
        await vestingWallet.waitForDeployment();
        // call keycoin.setVestingWallet
        await keycoin.setVestingWallet(vestingWallet.target);

        const USDCMockFactory = await ethers.getContractFactory('USDCMock');
        usdc = await USDCMockFactory.deploy();
        await usdc.waitForDeployment();
        usdcDecimals = parseInt(await usdc.decimals());
        const KeycoinCrowdsaleFactory = await ethers.getContractFactory('KeycoinCrowdsale');
        crowdsale = await KeycoinCrowdsaleFactory.deploy(signers.owner.address, keycoin.target, usdc.target);
        await crowdsale.waitForDeployment();

    })

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
        // group 1 (reserve)
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
        // group 5 (USDC Staking)
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

        const reserveGroup = await vestingWallet.supplyGroupVesting(await keccak256(toUtf8Bytes("CASHFLOW")));

        const reserveReleasablePast = await vestingWallet.releasable(await keccak256(toUtf8Bytes("CASHFLOW")), parseInt(Date.now()/1000) - 1);
        await expect(reserveReleasablePast.toString()).to.eq('0');

        const reserveReleasableNow = await vestingWallet.releasable(await keccak256(toUtf8Bytes("CASHFLOW")), 0);
        await expect(reserveReleasableNow).to.be.above(0);

        await expect(
            from(signers.minter, vestingWallet).release(await keccak256(toUtf8Bytes("CASHFLOW")), signers.user2.address)
        ).to.be.revertedWithCustomError(vestingWallet, "OwnableUnauthorizedAccount")

        await expect(
            await keycoin.balanceOf(signers.user2.address)
        ).to.eq(0);

        await expect(
            from(signers.owner, vestingWallet).release(await keccak256(toUtf8Bytes("CASHFLOW")), signers.user2.address)
        ).to.be.fulfilled;

        await expect(
            await keycoin.balanceOf(signers.user2.address)
        ).to.be.above(reserveReleasableNow);    // time has past since last call to `releasable`

        const reserveReleasableAtEnd = await vestingWallet.releasable(await keccak256(toUtf8Bytes("CASHFLOW")), reserveGroup[5].toString()); 
        await expect(reserveReleasableAtEnd.toString()).to.eq(reserveGroup[0].toString());
        
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
        const KeycoinV2 = await ethers.getContractFactory("KeycoinV2", signers.upgrader);
        const KeycoinV2_BAD_SIGNER = await ethers.getContractFactory("KeycoinV2", signers.owner);
    
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

    it('should be able to distribute KEYCOIN tokens from owner withdrawable USDC', async() => {
        const client1 = signers.user1;
        const client2 = signers.user2;
        // give USDC to clients
        await usdc.mint(client1.address, parseUnits('1000', usdcDecimals));
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
        await expect(
            from(client1, crowdsale).quoteFromUsdc(parseUnits('10', usdcDecimals))
        ).to.be.fulfilled;
        await expect(await usdc.balanceOf(client1.address)).to.eq(parseUnits('1000', usdcDecimals));
        const quote1 = await crowdsale.quoteFromUsdc(parseUnits('100', usdcDecimals));
        await expect(quote1[0]).to.eq('2222222222222200000000');

        /// user1 spends 100 usdc to get KEYCOIN
        // authorize crowdsale contract to spend 100USDC
        await expect(
            from(client1, usdc).approve(crowdsale.target, parseUnits('100', usdcDecimals))
        ).to.be.fulfilled;

        expect(await usdc.allowance(client1.address, crowdsale.target)).to.eq(parseUnits('100', usdcDecimals));
 
        await expect(
            from(client1, crowdsale).purchaseFromUsdc(parseUnits('100', usdcDecimals))
        ).to.be.fulfilled;

        expect(await keycoin.balanceOf(client1.address)).to.eq(quote1[0]);
        expect((await crowdsale.currentPricePolicy())[1]).to.eq(phaseRate[0]);
        expect((await crowdsale.currentPricePolicy())[2]).to.eq(quote1[0]);
        expect(await crowdsale.totalSold()).to.eq(quote1[0]);
        expect(await usdc.balanceOf(crowdsale.target)).to.eq(parseUnits('100', usdcDecimals));

        await expect(from(signers.user1, crowdsale).withdraw(parseUnits('65', usdcDecimals), signers.owner.address)).to.be.revertedWithCustomError(crowdsale, 'OwnableUnauthorizedAccount');
        await expect(from(signers.owner, crowdsale).withdraw(parseUnits('65', usdcDecimals), signers.owner.address)).to.be.revertedWith('EXCEEDS 20% LIMIT');
        
        // sell KEYCOIN to reach soft cap
        await usdc.mint(client2.address, parseUnits('150000', usdcDecimals));
        await expect(
            from(client2, usdc).approve(crowdsale.target, parseUnits('150000', usdcDecimals))
        ).to.be.fulfilled;
        expect(await usdc.allowance(client2.address, crowdsale.target)).to.eq(parseUnits('150000', usdcDecimals));
        await expect(
            from(client2, crowdsale).purchaseFromUsdc(parseUnits('150000', usdcDecimals))
        ).to.be.fulfilled;

        // ok
        await expect(from(signers.owner, crowdsale).withdraw(parseUnits('65', usdcDecimals), signers.owner.address)).to.be.fulfilled;
        
        expect(await usdc.balanceOf(signers.owner.address)).to.eq(parseUnits('65', usdcDecimals));
        expect(await usdc.balanceOf(crowdsale.target)).to.eq(parseUnits('150035', usdcDecimals));
    })

    it('should respect the crowdsale schedule by sold supply', async() => {
        const client1 = signers.user1;
        const client2 = signers.user2;

        const tenM = parseUnits("2319000", usdcDecimals); // max 2320000 $
        
        // give USDC to clients
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

        const bal = parseUnits("1000000", usdcDecimals);
        const val = parseUnits("100000", usdcDecimals); // max supply purchase 2320000 $
        
        // give USDC to clients
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

    it('should execute "closeCrowdsale_sendToDao_burnUnsold" as expected', async() => {
        const client1 = signers.user1;
        const client2 = signers.user2;
        const daoWallet = signers.user3;

        const val = parseUnits("1150000", usdcDecimals); // max supply purchase 2320000 $
        
        // give USDC to clients
        await usdc.mint(client1.address, val);
        await usdc.mint(client2.address, val);
      

        await expect(from(signers.minter).mintCrowdsaleSupplyAndOpen(crowdsale.target)).not.to.be.rejected;

        await expect(approveAndPurchase(client1, val)).not.to.be.rejected;

        // crowdsale still opened
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

    it('should refund 80% after end of crowdsale if softcap is not reached', async() => {
        const client1 = signers.user1;
        const client2 = signers.user2;
        
        // give USDC to clients
        await usdc.mint(client1.address, parseUnits("100000", usdcDecimals));
        await usdc.mint(client2.address, parseUnits("100000", usdcDecimals));
    
        // open crowdsale
        await expect(from(signers.minter).mintCrowdsaleSupplyAndOpen(crowdsale.target)).not.to.be.rejected;
    
        // sell below soft-cap (140k$)
        await expect(
            from(client1, usdc).approve(crowdsale.target, parseUnits('100000', usdcDecimals))
        ).to.be.fulfilled;
        await expect(
            from(client1, crowdsale).purchaseFromUsdc(parseUnits('100000', usdcDecimals))
        ).to.be.fulfilled;
        await expect(
            from(client2, usdc).approve(crowdsale.target, parseUnits('40000', usdcDecimals))
        ).to.be.fulfilled;
        await expect(
            from(client2, crowdsale).purchaseFromUsdc(parseUnits('40000', usdcDecimals))
        ).to.be.fulfilled;
    
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
        expect(await usdc.balanceOf(crowdsale.target)).to.eq(parseUnits('140000', usdcDecimals));
    
        // refund client 1 (100k deposit → 80k refund)
        expect(await usdc.balanceOf(client1.address)).to.eq(parseUnits('0', usdcDecimals));
        await expect(from(client1, crowdsale).refundMe()).not.to.be.rejected;
        expect(await usdc.balanceOf(client1.address)).to.eq(parseUnits('80000', usdcDecimals));
    
        // contract now holds 140k - 80k = 60k
        expect(await usdc.balanceOf(crowdsale.target)).to.eq(parseUnits('60000', usdcDecimals));
    
        // refund client 2 (40k deposit → 32k refund)
        expect(await usdc.balanceOf(client2.address)).to.eq(parseUnits('60000', usdcDecimals));
        await expect(from(client2, crowdsale).refundMe()).not.to.be.rejected;
        expect(await usdc.balanceOf(client2.address)).to.eq(parseUnits('92000', usdcDecimals));
    
        // contract now holds 60k - 32k = 28k (20% retained)
        expect(await usdc.balanceOf(crowdsale.target)).to.eq(parseUnits('28000', usdcDecimals));
    
        // check that clients can't be refunded more than once
        await expect(from(client1, crowdsale).refundMe()).to.be.rejectedWith("NO PURCHASE");        // already refunded
    });
}) 