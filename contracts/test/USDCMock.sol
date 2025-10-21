// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract USDCMock is ERC20 {
    constructor() ERC20('USDCMock', 'USDC') {}

    /* USDC uses 6 decimals */
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint amount) public {
        _mint(to, amount);
    }

    function approve(address spender, uint256 value) public override returns(bool approved) {
        address owner = _msgSender();
        _approve(owner, spender, value);
        return true;
    }
}