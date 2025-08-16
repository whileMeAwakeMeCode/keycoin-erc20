// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./Storage.sol";
import "./IKeycoinVesting.sol";
import "./IKeycoinCrowdsale.sol";

contract Keycoin is
  Initializable,
  ERC20Upgradeable,
  ERC20PausableUpgradeable,
  AccessControlUpgradeable,
  UUPSUpgradeable,
  Storage
{
  bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
  bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
  bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  function initialize(address defaultAdmin, address pauser, address minter, address upgrader) public initializer {
    __ERC20_init("Keycoin", "KEYCOIN");
    __ERC20Pausable_init();
    __AccessControl_init();
    __UUPSUpgradeable_init();

    _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
    _grantRole(PAUSER_ROLE, pauser);
    _grantRole(MINTER_ROLE, minter);
    _grantRole(UPGRADER_ROLE, upgrader);

    supplyGroups[1] = keccak256("CASHFLOW");
    supplyGroups[2] = keccak256("TEAM");
  }

  /**
   * @dev Mint 36M KEYCOINS to the Crowdsale contract and officially open the crowdsale
   */
  function mintCrowdsaleSupplyAndOpen(address crowdsaleContract) public onlyRole(MINTER_ROLE) {
    require(currentSupply[3] == 0, "CROWDSALE ALREADY OPENED");
    mint(crowdsaleContract, 36000000*10**18, 3);
    bool opened = IKeycoinCrowdsale(crowdsaleContract).openCrowdsale();
    require(opened, "CROWDSALE OPENING FAILED");
  }

  function burn(uint amount) external {
    _burn(_msgSender(), amount);
  }

  function addSupplyGroup(uint groupIndex, bytes32 groupCode) external onlyRole(DEFAULT_ADMIN_ROLE) {
    supplyGroups[groupIndex] = groupCode;
  }

  function _update(
      address from,
      address to,
      uint256 value
  ) internal override(ERC20Upgradeable, ERC20PausableUpgradeable) {
      super._update(from, to, value);
  }

  function setVestingWallet(address _vestingWallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
    vestingWallet = _vestingWallet;
  }

  function pause() public onlyRole(PAUSER_ROLE) {
    _pause();
  }

  function unpause() public onlyRole(PAUSER_ROLE) {
    _unpause();
  }

  function _mintToVestingWallet(bytes32 _sGroup, uint256 _amount) internal {
    require(vestingWallet != address(0), "VESTING WALLET UNSET");
    bool sent = IKeycoinVesting(vestingWallet).receiveVesting(_sGroup, _amount);
    require(sent, "VESTING NOT SENT");
    _mint(vestingWallet, _amount);
  }

  function mint(address to, uint256 amount, uint supplyGroup) public onlyRole(MINTER_ROLE) {
    require(
      (supplyGroup > 0) && (supplyGroup <= 6),
      "UNKOWN_SUPPLY_GROUP"
    );

    uint sGroupAmount = currentSupply[supplyGroup] + amount;
    uint maxGroupSupply = (
      supplyGroup > 4
      ? 108000000
      : 36000000
    );

    require(
      sGroupAmount <= (maxGroupSupply * 10 ** 18),
      "SUPPLY_GROUP_OVERFLOW"
    );

    currentSupply[supplyGroup] += amount;

    if (supplyGroup < 3) {  // team or cashflow : vesting wallet
      _mintToVestingWallet(supplyGroups[supplyGroup], amount);
    }
    else _mint(to, amount);
  }

  function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}


  function version() public pure virtual returns (string memory) {
    return "1.0.0";
  }



}