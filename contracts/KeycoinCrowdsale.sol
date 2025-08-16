// SPDX-License-Identifier: GPL-v3-only
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "hardhat/console.sol";


/**
* @title Keycoin Crowdsale
* DISCOUNT POLICY
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
contract KeycoinCrowdsale is Ownable, ReentrancyGuard {

    bool public crowdsaleIsOpened;
    address public keycoinToken;
    address public usdcContract;
    uint256[] public schedule;

    constructor(address __owner, address __keycoinToken, address __usdcContract) 
    Ownable(__owner) 
    {
        require(__keycoinToken != address(0), "invalid token address");
        require(__usdcContract != address(0), "invalid collateral address");
        keycoinToken = __keycoinToken;
        usdcContract = __usdcContract;
        // maxSupply, tokensByUsdc, soldSupply, endDate
        schedule = [
            6000000*10**18, 22222222222222000000, 0, 0,  
            8000000*10**18, 18181818181818000000, 0, 0, 
            10000000*10**18, 15384615384615000000, 0, 0,
            12000000*10**18, 12500000000000000000, 0, 0
        ]; 
    }

    function totalSold() public view returns(uint tSold) {
        for (uint i = 0; i < 16; i+=4) {
            tSold += schedule[i+2];
        }
    }

    function setUsdcContract(address _usdcContract) public onlyOwner {
        require(_usdcContract != address(0), "invalid collateral address");
        usdcContract = _usdcContract;
    }

    function openCrowdsale() external returns(bool opened) {
        require(_msgSender() == keycoinToken, "KEYCOIN ONLY");
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

    function _currentPhaseIndex() internal view returns(uint i) {
        
        for (i = 0; i < 16; i+=4) {
            if (block.timestamp < schedule[i+3]) {       
                if (schedule[i+2] < (schedule[i] /* * 10**18 */)) {
                    return i;
                }
            }
        }

        return 17;
    }


    function _currentPricePolicy() internal view returns (uint maxSupply, uint tokensByUsdc, uint soldSupply, uint endDate) {
        
        // uint supply;
        // uint price;
        // uint sold;
        // uint date;
        uint i = _currentPhaseIndex();

        require(i < 17, "SOLD OUT");

        return(schedule[i], schedule[i+1], schedule[i+2], schedule[i+3]);    

        // for (i = 0; i < 16; i+=4) {
        //     if (block.timestamp < schedule[i+3]) {       
        //         if ((price == 0) && (schedule[i+2] < (schedule[i] * 10**18))) {
        //             supply = schedule[i];
        //             price = schedule[i+1]; 
        //             sold = schedule[i+2];     
        //             date = schedule[i+3];    
        //         }
        //     }
        // }

        // return (supply, price, sold, date);
    
    }

    /// @notice get the current price policy that is used to distribute KEYCOIN tokens during crowdsale
    /// @return maxSupply the maximum amount of tokens to be distributed during the current phase
    /// @return tokensByUsdc the amount of tokens to be distributed for 1 USDC
    /// @return soldSupply the amount of tokens that has been sold during the current phase
    /// @return endDate the maximum date that `tokensByUsdc` price will be used
    function currentPricePolicy() public view returns (uint maxSupply, uint tokensByUsdc, uint soldSupply, uint endDate) {
        return _currentPricePolicy();
    }

    /** [low-level]
    * @notice Internally computes the KEYCOIN tokens amount and USDC entrance fee amount to be received when receiving of USDC 
    * @param usdcAmount the amount of usdc received by this contract
    * @return tAmountOut KEYCOIN tokens amount to be received
    */
    // function _quoteFromUsdc(uint usdcAmount) internal view returns(uint tAmountOut) {
    //     (,uint tokensByUsdc,,) = _currentPricePolicy();
        
    //     tAmountOut = (
    //         (usdcAmount * tokensByUsdc) / 10**18
    //     );
    // }
    function _quoteFromUsdc(uint usdcAmount) internal view returns(uint tAmountOut, uint rest) {

        rest = usdcAmount;
        //console.log('------[ QUOTE for $', usdcAmount/10**18, ' ]--------');

        for (uint i = 0; (rest > 0) && (i < 16); i+=4) {

            //console.log("rest onstartloop #",i/4,": ", rest/10**18);

            if (block.timestamp < schedule[i+3]) {    
                uint maxSupply = schedule[i];
                uint currentSupply = schedule[i+2];
                uint tokensByUsdc = schedule[i+1];  // changeRate   

                if (currentSupply < maxSupply /* * 10**18 */) {

                    // max phase distribuable supply
                    uint phaseAvailSupply = maxSupply - currentSupply;
                    uint phaseAmountOut = (rest * tokensByUsdc) / 10**18;

                    // console.log('phaseAmountOut', phaseAmountOut/10**18);
                    // console.log('phaseAvailSupply', phaseAvailSupply/10**18);

                    if (phaseAmountOut <= phaseAvailSupply) {
                        //console.log('ENOUGH PHASE SUPPLY');
                        // enough supply avail in that phase
                        rest = 0;
                        tAmountOut += phaseAmountOut;
                        //break;
                    } 
                    else {
                        //console.log('SUPPLY OVERFLOW');
                        // phase avail supply overflow: jump to next phase
                        uint spentUsdc = ((phaseAvailSupply) / (tokensByUsdc)) * 10**18;  // phaseAvailSupply / tokensByUsdc;
                        //console.log('spentUsdc', spentUsdc/10**18);
                        rest -= spentUsdc;
                        tAmountOut += phaseAvailSupply;

                    }

                    //console.log('tAmountOut', tAmountOut/10**18);
                    //console.log('------------------');
                }

            }  
            //console.log("rest onendloop #",i/4,": ", rest/10**18);
            if (((i/4) == 3) && rest > 0) {
                //console.log('tAmountOut :', tAmountOut);
                // reimbursement
                
            }
            //console.log('------------------');

 
            
        }   // 2000000.000000000000000000 - 270000.000000000000000000;
        
        
            // 35987500000000000000000000
            //    12500000000000000000000
        
        
    }

    /**
    * @notice Compute the entrance fee and KEYCOIN tokens amounts to be received for a deposited amount of USDC
    * @param usdcAmount the amount of usdc to be exchanged for KEYCOIN tokens
    * @return tAmountOut the amount of KEYCOIN tokens that will be received 
    */
    function quoteFromUsdc(uint usdcAmount) public view returns(uint tAmountOut, uint rest) {
        return _quoteFromUsdc(usdcAmount);
    }



    // /**
    // * @notice Mint KEYCOIN tokens from USDC tokens
    // * @dev Low-Level internal method: all checks and USDC transfers must be done prior to the call
    // * @param to the address to send the KEYCOIN tokens to
    // * @param usdcAmount the amount of USDC that has already been sent to this contract in order to receive KEYCOIN tokens
    // */
    // function _purchaseFromUsdc(address to, uint usdcAmount) internal {
    //     uint tAmountOut = _quoteFromUsdc(usdcAmount);
    //     SafeERC20.safeTransfer(IERC20(keycoinToken), to, tAmountOut);
    // }

    /** [public][non-reentrant]
    * @notice Mint KEYCOIN tokens from USDC tokens
    * @dev Public method distributing KEYCOIN tokens to the msg.sender (non-reentrant) 
    * @param approvedUsdcAmount an amount of USDC token that's been already approved by sender on contract at `usdcContract`
    */
    function purchaseFromUsdc(uint approvedUsdcAmount) public crowdsaleOpened nonReentrant {
        require(approvedUsdcAmount>0, 'MIN-USDC-AMOUNT');

        address sender = _msgSender();
        
        (uint tAmountOut, uint quoteRest) = _quoteFromUsdc(approvedUsdcAmount);
        uint pIndex = _currentPhaseIndex();

        require(pIndex<17, "SOLD OUT");

        require(
            IERC20(usdcContract).transferFrom(sender, address(this), approvedUsdcAmount),
            'USDC-TRF-FAILED'
        );

        uint rest = tAmountOut;
        for (uint i = 0; i < (4 - (pIndex/4)); i++) {
            uint ind = pIndex+(i*4);
            //uint maxSupply = schedule[ind];
            //uint tokensByUsdc = schedule[ind+1];  
            //uint currentSupply = schedule[ind+2];
            uint phaseAvailSupply = schedule[ind] - schedule[ind+2];//maxSupply - currentSupply;
            // changeRate  
            // rest = tAmountOut > schedule[pIndex+2]
            // schedule[pIndex+2] += rest;
            if (rest <= phaseAvailSupply) {
                // enough supply avail in that phase
                schedule[ind+2] += rest;
                rest = 0;
                break;
            } 
            else {
                // phase avail supply overflow: jump to next phase
                schedule[ind+2] += phaseAvailSupply;
                rest -= phaseAvailSupply;

            }
        }
        

        SafeERC20.safeTransfer(IERC20(keycoinToken), sender, tAmountOut);

        if ((quoteRest > 0) && (quoteRest <= approvedUsdcAmount)) {
            // reimbursement
            //console.log('REIMBURSMENT OF $', quoteRest);
            SafeERC20.safeTransfer(IERC20(usdcContract), sender, quoteRest);
        }
    }


    function _usdcAvailSupply() internal view returns(uint usdcASupply) {
        IERC20 usdc = IERC20(usdcContract);
        usdcASupply = usdc.balanceOf(address(this));
    }

    /// @return usdcASupply the amount of USDC that is available for initial transfer into the liquidity pool
    function usdcAvailSupply() public view returns(uint usdcASupply) {
        usdcASupply = _usdcAvailSupply();
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

    /** [owner-only]
     * @notice Withdraw an amount of USDC held by this contract
     */
    function withdraw(uint usdcAmount, address to) external onlyOwner {
        require(to != address(0), 'NO USDC BURN');
        SafeERC20.safeTransfer(IERC20(usdcContract), to, usdcAmount);
    }

}