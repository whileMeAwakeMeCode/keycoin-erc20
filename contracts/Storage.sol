// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

contract Storage {

    /*
        MAXIMUM SUPPLY = 360M
        1: reserve (36M)
        2: team (36M)
        3: public sale (36M)
        4: CEX/DEX liquidity (36M)
        5: USDC staking (max 108M)
        6: KEYCOIN staking (max 108M)
    */
    mapping(uint => uint) public currentSupply;
    mapping(uint => bytes32) internal supplyGroups;

    address public vestingWallet;
    
    /**
     * holder account => token type => vesting balance (vBalances)
     */
    //mapping(address => mapping(uint => uint)) vBalances;

    
    

}