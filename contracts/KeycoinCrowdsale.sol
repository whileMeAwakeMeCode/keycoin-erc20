// SPDX-License-Identifier: GPL-v3-only
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./KycVerifier.sol";

// import "hardhat/console.sol";

interface IERC20Decimals is IERC20 {
    function decimals() external view returns (uint8);
}

interface IERC20Burn is IERC20 {
    function burn(uint amount) external;
}


/**
* @title Keycoin Crowdsale
* @author Mathieu L.
* @notice This contract is meant to distribute KEYCOIN token during the crowdsale phase only
* # Dedicated supply is 36 Millions KEYCOIN
* # DISCOUNT POLICY
*   ### P1
    - 6M @ 0.045 US$/token
    - 22.222222222222 KEYCOIN for 1 US$
    - 0.045 US$ for 1 KEYCOIN
    - Ends one month after crowdsale start

*   ### P2
    - 8M @ 0.055 US$/token
    - 18.181818181818 KEYCOIN for 1 US$
    - 0.055 US$ for 1 KEYCOIN
    - Ends two months after crowdsale start

*   ### P3
    - 10M @ 0.065 US$/token
    - 15.384615384615 KEYCOIN for 1 US$
    - 0.065 US$ for 1 KEYCOIN
    - Ends three months after crowdsale start

*   ### P4
    - 12M @ 0.080 US$/token
    - 12.500000000000 KEYCOIN for 1 US$
    - 0.080 US$ for 1 KEYCOIN
    - Ends five months after crowdsale start
*/
contract KeycoinCrowdsale is Ownable, KycVerifier, ReentrancyGuard {

    bool public crowdsaleIsOpened;
    address public keycoinToken;
    address public usdcContract;
    uint public usdcDecimals;
    uint public totalUsdcWithdrawn;
    uint256[] public schedule;
    
    mapping(address => uint) public usdcInvestNoDecimals;

    constructor(address __owner, address __keycoinToken, address __usdcContract, address __kycSigner) 
    Ownable(__owner) 
    KycVerifier(__kycSigner)
    {
        require(__keycoinToken != address(0), "invalid token address");
        require(__usdcContract != address(0), "invalid collateral address");
        keycoinToken = __keycoinToken;
        usdcContract = __usdcContract;
        usdcDecimals = IERC20Decimals(__usdcContract).decimals();

        // maxSupply, tokensByUsdc, soldSupply, endDate
        schedule = [
            /// - PRIVATE PHASES - ///
            6000000*10**18, 22222222222222000000, 0, 0,  
            8000000*10**18, 18181818181818000000, 0, 0, 
            /// - PUBLIC PHASES ///
            10000000*10**18, 15384615384615000000, 0, 0,   
            12000000*10**18, 12500000000000000000, 0, 0     
        ]; 
    }
    
    event Withdraw(address indexed to, uint256 uAmount);
    event Distributed(address indexed to, uint256 uAmount, uint256 tAmount);
    event Refunded(address indexed to, uint256 rAmount);
    event CrowdsaleClosed(uint burnedSupply, uint daoSupply, address indexed daoWallet);

    function totalSold() public view returns(uint tSold) {
        for (uint i = 0; i < 16; i+=4) {
            tSold += schedule[i+2];
        }
    }

    function setUsdcContract(address _usdcContract) public onlyOwner {
        require(_usdcContract != address(0), "invalid collateral address");
        usdcDecimals = IERC20Decimals(_usdcContract).decimals();
        usdcContract = _usdcContract;
    }

    function openCrowdsale() external returns(bool opened) {
        require(_msgSender() == keycoinToken, "KEYCOIN ONLY");
        require(!crowdsaleIsOpened, "CROWDSALE ALREADY OPENED");
        uint _now = block.timestamp;
        uint oneMonth = (365 days) / 12;

        schedule[3] = _now + oneMonth;
        schedule[7] = _now + (oneMonth * 2);
        schedule[11] = _now + (oneMonth * 3);
        schedule[15] = _now + (oneMonth * 5);

        crowdsaleIsOpened = true;
        opened = crowdsaleIsOpened;
    }

    /**
    * @notice Checks that crowdsale is still opened at time of execution. If crowdsale is closed and Pancakeswap pair has been created, the call will revert and throw the `CROWDSALE-CLOSED` error
    */
    modifier crowdsaleOpened() {
        require(crowdsaleIsOpened, 'CROWDSALE-CLOSED');
        _;
    }

    /** [low-level]
     * @dev Internally returns the ongoing crowdsale phase index
     */
    function _currentPhaseIndex() internal view returns(uint i) {
        
        for (i = 0; i < 16; i+=4) {
            if (block.timestamp < schedule[i+3]) {       
                if (schedule[i+2] < schedule[i]) {
                    return i;
                }
            }
        }

        return 17;
    }


    /** [low-level]
     * @dev Internally returns the price policy of the ongoing crowdsale phase
     * will throw if crowdsale is closed
     */
    function _currentPricePolicy() internal view returns (uint maxSupply, uint tokensByUsdc, uint soldSupply, uint endDate) {
        uint i = _currentPhaseIndex();

        require(i < 17, "SOLD OUT");

        return(schedule[i], schedule[i+1], schedule[i+2], schedule[i+3]);    
    
    }

    /// @notice Get the current price policy that is used to distribute KEYCOIN tokens during crowdsale
    /// @return maxSupply the maximum amount of tokens to be distributed during the current phase
    /// @return tokensByUsdc the amount of tokens to be distributed for 1 USDC
    /// @return soldSupply the amount of tokens that has been sold during the current phase
    /// @return endDate the maximum date that `tokensByUsdc` price will be used
    function currentPricePolicy() public view returns (uint maxSupply, uint tokensByUsdc, uint soldSupply, uint endDate) {
        return _currentPricePolicy();
    }

    /** [low-level] [usdc decimals dependent]
    * @notice Internally computes the KEYCOIN tokens amount and USDC entrance fee amount to be received when receiving of USDC 
    * @param usdcAmount the amount of usdc received by this contract
    * @return tAmountOut KEYCOIN tokens amount to be received
    */
    function _quoteFromUsdc(uint usdcAmount) internal view returns(uint tAmountOut, uint rest) {
        rest = usdcAmount;
        uint scaleFactor = 10**usdcDecimals; // KEYCOIN(18) vs USDC(6)

        for (uint i = 0; (rest > 0) && (i < 16); i+=4) {
            if (block.timestamp < schedule[i+3]) {    
                uint maxSupply = schedule[i];
                uint currentSupply = schedule[i+2];
                uint tokensByUsdc = schedule[i+1];   

                if (currentSupply < maxSupply) {
                    // max phase distribuable supply
                    uint phaseAvailSupply = maxSupply - currentSupply;

                    // compute how many KEYCOIN tokens user gets for "rest" USDC
                    uint phaseAmountOut = (rest * tokensByUsdc) / scaleFactor;

                    if (phaseAmountOut <= phaseAvailSupply) {
                        // sufficient supply 
                        rest = 0;
                        tAmountOut += phaseAmountOut;
                    } 
                    else {
                        // phase supply overflow: jump to next phase
                        uint spentUsdc = (phaseAvailSupply * scaleFactor) / tokensByUsdc;
                        rest -= spentUsdc;
                        tAmountOut += phaseAvailSupply;
                    }
                }
            }              
        }   
    }

    /**
    * @notice Compute the entrance fee and KEYCOIN tokens amounts to be received for a deposited amount of USDC
    * @param usdcAmount the amount of usdc to be exchanged for KEYCOIN tokens
    * @return tAmountOut the amount of KEYCOIN tokens that will be received 
    */
    function quoteFromUsdc(uint usdcAmount) public view returns(uint tAmountOut, uint rest) {
        return _quoteFromUsdc(usdcAmount);
    }

    /** [public][non-reentrant][usdc decimals dependent]
    * @notice Mint KEYCOIN tokens from USDC tokens by-passing KYC Signature Check
    * @dev Public method distributing KEYCOIN tokens to the msg.sender (non-reentrant) 
    * @param approvedUsdcAmount an amount of USDC already approved by sender on `usdcContract` (MAX 2000$)
    */
    function purchaseFromUsdc(uint approvedUsdcAmount) public {
        require(approvedUsdcAmount <= 2000 * 10**usdcDecimals, "KYC-REQUIRED");
        _purchaseFromUsdc(approvedUsdcAmount);
    }

    /** [public][non-reentrant][usdc decimals dependent]
    * @notice Mint KEYCOIN tokens from USDC tokens with KYC Signature Check
    * @dev Public method distributing KEYCOIN tokens to the msg.sender (non-reentrant) 
    * @param approvedUsdcAmount an amount of USDC already approved by sender on `usdcContract` (> 2000$)
    * @param deadline timestamp of the signature availability deadline
    * @param signature the bytes32 encoded KYC signature itself
    */
    function purchaseFromUsdcKyc(uint approvedUsdcAmount, uint256 deadline, bytes memory signature) public {
        _checkKyc(_msgSender(), deadline, signature);
        _purchaseFromUsdc(approvedUsdcAmount);
    }

    
    function _purchaseFromUsdc(uint approvedUsdcAmount) internal crowdsaleOpened nonReentrant {
        require(approvedUsdcAmount > 0, "MIN-USDC-AMOUNT");

        (uint tAmountOut, uint quoteRest) = _quoteFromUsdc(approvedUsdcAmount);
      
        uint pIndex = _currentPhaseIndex();

        require(pIndex < 17, "SOLD OUT");

        address sender = _msgSender();

        require(
            IERC20(usdcContract).transferFrom(sender, address(this), approvedUsdcAmount),
            "USDC-TRF-FAILED"
        );

        // ✅ rest is in KEYCOIN (18 decimals)
        uint rest = tAmountOut;
        for (uint i = 0; i < (4 - (pIndex / 4)); i++) {
            uint ind = pIndex + (i * 4);

            uint phaseAvailSupply = schedule[ind] - schedule[ind + 2];

            if (rest <= phaseAvailSupply) {
                schedule[ind + 2] += rest;
                rest = 0;
                break;
            } else {
                schedule[ind + 2] += phaseAvailSupply;
                rest -= phaseAvailSupply;
            }
        }

        SafeERC20.safeTransfer(IERC20(keycoinToken), sender, tAmountOut);

        // ✅ quoteRest is in USDC (6 decimals), safe to refund
        if (quoteRest > 0 && quoteRest <= approvedUsdcAmount) {
            SafeERC20.safeTransfer(IERC20(usdcContract), sender, quoteRest);
        }

        usdcInvestNoDecimals[sender] += ((approvedUsdcAmount - quoteRest) / (10**usdcDecimals));
        emit Distributed(sender, approvedUsdcAmount - quoteRest, tAmountOut);
    }


    /** [low-level]
     * @dev Internally retrieve the amount of USDC available
     */
    function _usdcAvailSupply() internal view returns(uint usdcASupply) {
        IERC20 usdc = IERC20(usdcContract);
        usdcASupply = usdc.balanceOf(address(this));
    }

    /// @return usdcASupply the amount of USDC that is available for initial transfer into the liquidity pool
    function usdcAvailSupply() public view returns(uint usdcASupply) {
        usdcASupply = _usdcAvailSupply();
    }

    /** [owner-only]
     * @notice Allow owner to delay crowdsale end
     */
    function delayCrowdsale(uint p4Timestamp) external onlyOwner {
        require(schedule[15] < p4Timestamp, "UNIX-BELOW");
        schedule[15] = p4Timestamp;
    }

    /** [owner-only]
     * @notice Pause crowdsale
     */
    function pauseCrowdsale() external onlyOwner {
        crowdsaleIsOpened = false;
    }

    /** [owner-only]
     * @notice Unpause crowdsale
     */
    function unpauseCrowdsale() external onlyOwner {
        require(
            (block.timestamp < schedule[15]),
            'CROWDSALE-TIMEOUT'
        );
        crowdsaleIsOpened = true;
    }

    function _softCapReached() internal view returns(bool sReached) {
        uint softCap = 150000 * 10**usdcDecimals;
        sReached = (_usdcAvailSupply() + totalUsdcWithdrawn) >= softCap;
    }

    /** [owner-only]
     * @notice Withdraw an amount of USDC held by this contract
     * The maximum withdrawable amount varies depending on :
     *  - The softcap of 150k$ has not been reached -> max 20% of total collected
     *  - The softcap has been reached -> 100% of total collected
     */
    function withdraw(uint256 uAmount, address to) external onlyOwner {
        require(to != address(0), "NO USDC BURN");

        uint256 balance = IERC20(usdcContract).balanceOf(address(this));
        uint256 totalCollected = balance + totalUsdcWithdrawn;

        if (_softCapReached()) {
            // softcap reached: limited withdrawal
            totalUsdcWithdrawn += uAmount;
            SafeERC20.safeTransfer(IERC20(usdcContract), to, uAmount);
        } else {
            // softcap unreached: max 20% of total collected
            uint256 maxWithdrawable = (totalCollected * 20) / 100;
            require(totalUsdcWithdrawn + uAmount <= maxWithdrawable, "EXCEEDS 20% LIMIT");

            totalUsdcWithdrawn += uAmount;
            SafeERC20.safeTransfer(IERC20(usdcContract), to, uAmount);
        }

        emit Withdraw(to, uAmount);
    }

    /**
     * @dev Allow clients to be refunded of 80% of their investments in the case the the softcap of 150k$ has not been reached
     * This method is callable only after the end of the last crowdsale period (P4)
     */
    function refundMe() external {
        require(block.timestamp > schedule[15], "CROWDSALE ONGOING"); // crowdsale must be closed
        require(!_softCapReached(), "SOFTCAP REACHED");               // softcap must not be reached

        address sender = _msgSender();
        uint256 rBal = usdcInvestNoDecimals[sender];
        require(rBal > 0, "NO PURCHASE");

        // Reset balance before transfer (protection against re-entrancy)
        usdcInvestNoDecimals[sender] = 0;

        // Refund 80% of deposit
        uint256 refundAmountDec = ((rBal * 80) / 100) * 10**usdcDecimals;
        SafeERC20.safeTransfer(IERC20(usdcContract), sender, refundAmountDec);

        emit Refunded(sender, refundAmountDec);
    }

    /** [owner-only]
     * @dev Allows owner to close the crowdsale, burn half of the remaining supply and send the rest to a DAO wallet for future operations
     * @param daoWallet account that will be used as a DAO operator
     */
    function closeCrowdsale_sendToDao_burnUnsold(address daoWallet) external onlyOwner crowdsaleOpened {
        require(_softCapReached(), "SOFTCAP UNREACHED");
        require(daoWallet != address(0), "INVALID DAO WALLET");

        uint totalSaleSupply = 36000000 * 10**18;
        require(
            (totalSold() == totalSaleSupply)
            || (block.timestamp > schedule[15]), 
            "CROWDSALE ONGOING"
        );

        crowdsaleIsOpened = false;
        uint unsold = totalSaleSupply - totalSold();

        if(unsold > 0) {

            uint halfToBurn = ((unsold*10**18) / 2) / 10**18;
            uint daoSupply = unsold - halfToBurn;

            SafeERC20.safeTransfer(IERC20(keycoinToken), daoWallet, daoSupply);
            IERC20Burn(keycoinToken).burn(halfToBurn);
            emit CrowdsaleClosed(halfToBurn, daoSupply, daoWallet);
        }

        else emit CrowdsaleClosed(0, 0, daoWallet);

    }

}