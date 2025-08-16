const { days } = require('@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time/duration');
const { expect } = require('chai');
const { keccak256, toUtf8Bytes, parseEther, formatEther } = require('ethers');
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
    let keycoin;
    let vestingWallet;
    let crowdsaleContract;
    let usdc;
    let signers = {};

    const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
    const PAUSER_ROLE = keccak256(toUtf8Bytes("PAUSER_ROLE"));
    const MINTER_ROLE = keccak256(toUtf8Bytes("MINTER_ROLE"));
    const UPGRADER_ROLE = keccak256(toUtf8Bytes("UPGRADER_ROLE"));

    let from = (sig, contract) => ((contract || keycoin).connect(sig));

    async function approveAndPurchase(signer, value) {
        await from(signer, usdc).approve(crowdsaleContract.target, value);
        await from(signer, crowdsaleContract).purchaseFromUsdc(value);
        console.log(formatEther(value), '$ approved, keycoin have been purchased !');
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

        const KeycoinCrowdsaleFactory = await ethers.getContractFactory('KeycoinCrowdsale');
        crowdsaleContract = await KeycoinCrowdsaleFactory.deploy(signers.owner.address, keycoin.target, usdc.target);
        await crowdsaleContract.waitForDeployment();

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
        //try {
        const client1 = signers.user1;
        // give USDC to clients
        await usdc.mint(client1.address, parseEther('1000'));
        // open KEYCOIN crowdsale
        await expect(
            from(signers.minter).mintCrowdsaleSupplyAndOpen(crowdsaleContract.target)
        ).to.be.fulfilled;
        const bal = (await keycoin.balanceOf(crowdsaleContract.target)).toString();
        await expect(bal).to.eq(await parseEther('36000000').toString());
        // client1 buys KEYCOIN in phase 1
        await expect(
            from(client1, crowdsaleContract).quoteFromUsdc(parseEther('10'))
        ).to.be.fulfilled;
        await expect(await usdc.balanceOf(client1.address)).to.eq(parseEther('1000'));
        const quote1 = await crowdsaleContract.quoteFromUsdc(parseEther('100'));
        await expect(quote1[0]).to.eq('2222222222222200000000');

        /// user1 spends 100 usdc to get KEYCOIN
        // authorize crowdsale contract to spend 100USDC
        await expect(
            from(client1, usdc).approve(crowdsaleContract.target, parseEther('100'))
        ).to.be.fulfilled;

        expect(await usdc.allowance(client1.address, crowdsaleContract.target)).to.eq(parseEther('100'));
 
        await expect(
            from(client1, crowdsaleContract).purchaseFromUsdc(parseEther('100'))
        ).to.be.fulfilled;

        expect(await keycoin.balanceOf(client1.address)).to.eq(quote1[0]);
        expect((await crowdsaleContract.currentPricePolicy())[1]).to.eq(phaseRate[0]);
        expect((await crowdsaleContract.currentPricePolicy())[2]).to.eq(quote1[0]);
        expect(await crowdsaleContract.totalSold()).to.eq(quote1[0]);
        expect(await usdc.balanceOf(crowdsaleContract.target)).to.eq(parseEther('100'));

        await expect(from(signers.user1, crowdsaleContract).withdraw(parseEther('65'), signers.owner.address)).to.be.revertedWithCustomError(crowdsaleContract, 'OwnableUnauthorizedAccount');
        await expect(from(signers.owner, crowdsaleContract).withdraw(parseEther('65'), signers.owner.address)).to.be.fulfilled;
        
        expect(await usdc.balanceOf(signers.owner.address)).to.eq(parseEther('65'));
        expect(await usdc.balanceOf(crowdsaleContract.target)).to.eq(parseEther('35'));
        //}catch(e) {console.log('"should be able to distribute KEYCOIN" ERROR:', e)}
    })

    it('should respect the crowdsale schedule by sold supply', async() => {
        //try {
        const client1 = signers.user1;
        const client2 = signers.user2;

        const tenM = parseEther('2319000'); // max 2320000 $
        
        // give USDC to clients
        await usdc.mint(client1.address, tenM);
        await usdc.mint(client2.address, tenM);
        // await usdc.mint(client4.address, tenM);

        // transfer supply & open crowdsale
        await from(signers.minter).mintCrowdsaleSupplyAndOpen(crowdsaleContract.target)

        await expect(approveAndPurchase(client1, tenM)).not.to.be.rejected;
        
        // console.log('currentPricePolicy', (await crowdsaleContract.currentPricePolicy()).map((p, pi) => (pi < 3 ? formatEther(p) : p)));
        console.log('totalSold', formatEther(await crowdsaleContract.totalSold()));
        await expect(approveAndPurchase(client2, tenM)).not.to.be.rejected;

        console.log('totalSold 2', formatEther(await crowdsaleContract.totalSold()));

        await expect(approveAndPurchase(client2, tenM)).to.be.rejectedWith('SOLD OUT');

    })
    

    it('should respect the crowdsale schedule by time', async() => {
        const client1 = signers.user1;
        const client2 = signers.user2;
        const client3 = signers.user3;
        const client4 = signers.user3;

        const bal = parseEther('1000000'); 
        const val = parseEther('100000'); // max supply purchase 2320000 $
        
        // give USDC to clients
        await usdc.mint(client1.address, bal);
        await usdc.mint(client2.address, bal);
        await usdc.mint(client3.address, bal);
        await usdc.mint(client4.address, bal);

        // transfer supply & open crowdsale
        await from(signers.minter).mintCrowdsaleSupplyAndOpen(crowdsaleContract.target)

        await expect(approveAndPurchase(client1, val)).not.to.be.rejected;
        const c1Bal = await keycoin.balanceOf(client1.address);
        const pp = await crowdsaleContract.currentPricePolicy();

        // goto phase 2
        await time.increaseTo(parseInt(pp[3])+10);
        await expect(approveAndPurchase(client2, val)).not.to.be.rejected;
        const pp2 = await crowdsaleContract.currentPricePolicy();

        expect(pp2[1]).to.eq(phaseRate[1]);

        const c2Bal = await keycoin.balanceOf(client2.address);

        expect(parseInt(c1Bal)).to.be.above(parseInt(c2Bal));

        // goto phase 3
        await time.increaseTo(parseInt(pp2[3])+10);
        await expect(approveAndPurchase(client3, val)).not.to.be.rejected;
        const pp3 = await crowdsaleContract.currentPricePolicy();
        expect(pp3[1]).to.eq(phaseRate[2]);

        // goto phase 4
        await time.increaseTo(parseInt(pp3[3])+10);
        await expect(approveAndPurchase(client4, val)).not.to.be.rejected;
        const pp4 = await crowdsaleContract.currentPricePolicy();
        expect(pp4[1]).to.eq(phaseRate[3]);

        // goto crowdsale end
        await time.increaseTo(parseInt(pp4[3])+10);
        // crowdsale ended
        await expect(approveAndPurchase(client1, val)).to.be.rejectedWith('SOLD OUT');

        const tSold = (await Promise.all(phaseRate.map(r => (100000 * parseFloat(formatEther(r)))))).reduce((a, b) => (a + b))
        expect(await crowdsaleContract.totalSold()).to.eq(parseEther(tSold.toString()));
    })
}) 