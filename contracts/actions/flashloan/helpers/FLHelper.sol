// SPDX-License-Identifier: MIT

pragma solidity =0.8.10;

import "./BaseFLAddresses.sol";
import "../../../utils/FLFeeFaucet.sol";

contract FLHelper is BaseFLAddresses {
    uint16 internal constant AAVE_REFERRAL_CODE = 64;
    uint16 internal constant SPARK_REFERRAL_CODE = 0;
    FLFeeFaucet public constant flFeeFaucet = FLFeeFaucet(DYDX_FL_FEE_FAUCET);
}