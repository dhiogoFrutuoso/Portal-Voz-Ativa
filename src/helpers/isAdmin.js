function isAdmin(req, res, next) { //Verifica se o usuário é admin
    if(req.isAuthenticated() && req.user.areAdmin == 1) {
        return next();
    }

    req.flash('error_msg', 'Você não possui permissão para acessar essa página');
    res.redirect('/');

};

export default isAdmin;