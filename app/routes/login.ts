import { page } from "spacefn";

import * as Login from "#modules/auth/login.ts";
import { loginPage } from "#modules/auth/views.ts";

export default page({ loader: Login.load, render: ({ data }) => loginPage(data) });
