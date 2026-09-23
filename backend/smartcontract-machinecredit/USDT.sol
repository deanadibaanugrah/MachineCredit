// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface USDTInterface {

    function approve(
        address spender,
        uint256 amount
    ) external returns (bool);

    function balanceOf(
        address account
    ) external view returns (uint256);

    function allowance(
        address owner,
        address spender
    ) external view returns (uint256);
}