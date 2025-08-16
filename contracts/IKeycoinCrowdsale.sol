// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IKeycoinCrowdsale {
    /**
     * @notice Called to open KEYCOIN crowdsale
     */
    function openCrowdsale() external returns(bool opened);
}