import { defaultRequest as productDefault } from "../../src/domain/request";
/** Explicit historical PRN fixture. Changing the product default must not change
 * the origin of synthetic PRN fare/road evidence used to test pricing algorithms. */
export const defaultRequest = { ...productDefault, originId: "prishtina" };
