// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "./Keycoin.sol";

contract KeycoinV2 is
  Keycoin
{

    // upgrade added storage
    uint public v2Storage;  

    function version() public pure virtual override returns (string memory) {
        return "2.0.0";
    }

    // upgrade added method
    function changeV2Storage(uint value) public {
        v2Storage = value;
    }

}